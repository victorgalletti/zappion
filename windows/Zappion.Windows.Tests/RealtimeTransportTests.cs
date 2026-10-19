// SPDX-License-Identifier: AGPL-3.0-only
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class RealtimeTransportTests
{
    [Fact]
    public async Task OrganizationChannelRoutesEveryTableMapsReceiptsAndCanRejoin()
    {
        await using var server = new RealtimeServer();
        using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-key"));
        var messages = Channel.CreateUnbounded<(MessageRow Row, bool Insert)>();
        var conversations = Channel.CreateUnbounded<ConversationRow?>();
        var approvals = Channel.CreateUnbounded<bool>();
        var states = Channel.CreateUnbounded<bool>();
        client.MessageChanged += (row, insert) => messages.Writer.TryWrite((row, insert));
        client.ConversationsChanged += row => conversations.Writer.TryWrite(row);
        client.ApprovalsChanged += () => approvals.Writer.TryWrite(true);
        client.ConnectionChanged += joined => states.Writer.TryWrite(joined);

        var accepting = server.AcceptAsync(sendSubscription: false);
        var connecting = client.StartRealtimeAsync("organization");
        await accepting;
        Assert.False(connecting.IsCompleted);
        Assert.False(client.IsRealtimeConnected);
        await server.SubscribeAsync();
        await connecting.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.EndsWith("org:organization", server.Topic);
        Assert.Equal(new[] { "messages", "conversations", "zappion_message_approvals" }, server.Filters.Select(f => (string?)f["table"]));
        Assert.All(server.Filters, f =>
        {
            Assert.Equal("public", (string?)f["schema"]);
            Assert.Equal("*", (string?)f["event"]);
            Assert.Equal("organization_id=eq.organization", (string?)f["filter"]);
        });
        Assert.False(await Read(states.Reader));
        while (!await Read(states.Reader)) { }

        var record = JObject.Parse("{id:'message',organization_id:'organization',conversation_id:'chat',service:'whatsapp',sender_address:null,content:{type:'text',text:'Hello'},timestamp:'2026-10-16T00:00:00Z',status:{sent:'now'}}");
        await server.ChangeAsync("messages", "INSERT", record);
        var insert = await Read(messages.Reader);
        Assert.True(insert.Insert);
        Assert.Equal("message", insert.Row.Id);
        Assert.Equal("sent", ChatHelpers.DeliveryState(insert.Row.Status));
        Assert.Equal("message", Assert.Single(client.Messages.Get(["chat"])!.Rows).Id);

        await server.ChangeAsync("conversations", "UPDATE", JObject.Parse("{id:'chat',organization_id:'foreign',service:'whatsapp',name:'Ignored'}"));
        await server.ChangeAsync("conversations", "UPDATE", JObject.Parse("{id:'chat',organization_id:'organization',service:'whatsapp',name:'Updated',organization_address:'instance',address:'5511999999999',updated_at:'2026-10-16T12:00:00Z'}"));
        var changed = await Read(conversations.Reader);
        Assert.NotNull(changed);
        Assert.Equal("chat", changed.Id);
        Assert.Equal("organization", changed.OrganizationId);
        Assert.Equal("Updated", changed.Name);
        Assert.Equal("whatsapp", changed.Service);
        Assert.Equal("2026-10-16T12:00:00Z", changed.UpdatedAt);
        await server.ChangeAsync("conversations", "DELETE", new JObject());
        Assert.Null(await Read(conversations.Reader));
        await server.ChangeAsync("conversations", "UPDATE", new JObject());
        Assert.False(client.ApplyConversation(await Read(conversations.Reader)));
        // A held message's approval row changes: the owner reloads the waiting list.
        await server.ChangeAsync("zappion_message_approvals", "UPDATE", JObject.Parse("{message_id:'message',organization_id:'organization',conversation_id:'chat',api_key_name:'Bot',decision:'approved'}"));
        Assert.True(await Read(approvals.Reader));
        record["status"] = JObject.Parse("{read:'now'}");
        await server.ChangeAsync("messages", "UPDATE", record);
        var update = await Read(messages.Reader);
        Assert.False(update.Insert);
        Assert.Equal("read", ChatHelpers.DeliveryState(update.Row.Status));
        Assert.Equal("read", ChatHelpers.DeliveryState(Assert.Single(client.Messages.Get(["chat"])!.Rows).Status));

        record["organization_id"] = "different-organization";
        await server.ChangeAsync("messages", "INSERT", record);
        // A subsequent valid event acts as a barrier; the foreign row must not precede it.
        record["organization_id"] = "organization";
        record["id"] = "barrier";
        await server.ChangeAsync("messages", "INSERT", record);
        Assert.Equal("barrier", (await Read(messages.Reader)).Row.Id);

        await client.StartRealtimeAsync("organization");
        Assert.False(server.HasPendingConnection);
        accepting = server.AcceptAsync();
        client.Messages.Store(["chat"], [update.Row]);
        Assert.False(client.Messages.Get(["chat"])!.IsStale);
        server.DropConnection();
        while (await Read(states.Reader)) { }
        Assert.True(client.Messages.Get(["chat"])!.IsStale);
        await accepting;
        while (!await Read(states.Reader)) { }
        record["id"] = "after-network-loss";
        await server.ChangeAsync("messages", "INSERT", record);
        Assert.Equal("after-network-loss", (await Read(messages.Reader)).Row.Id);

        client.StopRealtime();
        accepting = server.AcceptAsync();
        connecting = client.StartRealtimeAsync("organization");
        await accepting;
        await connecting.WaitAsync(TimeSpan.FromSeconds(10));
        record["id"] = "after-rejoin";
        await server.ChangeAsync("messages", "INSERT", record);
        Assert.Equal("after-rejoin", (await Read(messages.Reader)).Row.Id);
    }

    private static async Task<T> Read<T>(ChannelReader<T> reader) =>
        await reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));

    // Exercise the installed Supabase transport against Phoenix envelopes, without an external service.
    private sealed class RealtimeServer : IAsyncDisposable
    {
        private readonly TcpListener listener = new(IPAddress.Loopback, 0);
        private readonly List<TcpClient> connections = new();
        private readonly List<WebSocket> sockets = new();
        private WebSocket? socket;
        public string Topic { get; private set; } = "";
        public JObject[] Filters { get; private set; } = [];
        public string Url { get; }
        public bool HasPendingConnection => listener.Pending();
        public void DropConnection() => connections[^1].Dispose();

        public RealtimeServer()
        {
            listener.Start();
            Url = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}";
        }

        public async Task AcceptAsync(bool sendSubscription = true)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var connection = await listener.AcceptTcpClientAsync(timeout.Token);
            connections.Add(connection);
            var stream = connection.GetStream();
            var header = new List<byte>();
            var single = new byte[1];
            while (!Encoding.ASCII.GetString(header.ToArray()).EndsWith("\r\n\r\n", StringComparison.Ordinal))
            {
                await stream.ReadExactlyAsync(single, timeout.Token);
                header.Add(single[0]);
            }
            var key = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n")
                .Single(l => l.StartsWith("Sec-WebSocket-Key:", StringComparison.OrdinalIgnoreCase)).Split(':', 2)[1].Trim();
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"), timeout.Token);
            socket = WebSocket.CreateFromStream(stream, true, null, TimeSpan.FromSeconds(30));
            sockets.Add(socket);
            JObject join;
            do { join = await ReceiveAsync(timeout.Token); } while ((string?)join["event"] != "phx_join");
            Topic = (string)join["topic"]!;
            Filters = join["payload"]!["config"]!["postgres_changes"]!.Children<JObject>().ToArray();
            var bindings = new JArray(Filters.Select((filter, index) =>
            {
                var binding = (JObject)filter.DeepClone();
                binding["id"] = index + 1;
                return binding;
            }));
            await SendAsync(new JObject
            {
                ["topic"] = Topic, ["event"] = "phx_reply", ["ref"] = join["ref"]?.DeepClone(),
                ["payload"] = new JObject { ["status"] = "ok", ["response"] = new JObject { ["postgres_changes"] = bindings } }
            });
            if (sendSubscription) await SubscribeAsync();
        }

        public Task SubscribeAsync() => SendAsync(new JObject
            {
                ["topic"] = Topic, ["event"] = "system", ["payload"] = new JObject
                { ["status"] = "ok", ["extension"] = "postgres_changes", ["message"] = "Subscribed to PostgreSQL" }
            });

        public Task ChangeAsync(string table, string type, JObject record) => SendAsync(new JObject
        {
            ["topic"] = Topic, ["event"] = "postgres_changes", ["payload"] = new JObject
            {
                ["ids"] = new JArray(table switch { "messages" => 1, "conversations" => 2, _ => 3 }),
                ["data"] = new JObject
                {
                    ["schema"] = "public", ["table"] = table, ["type"] = type,
                    ["commit_timestamp"] = "2026-10-16T00:00:00Z", ["record"] = record.DeepClone(), ["old_record"] = new JObject()
                }
            }
        });

        private async Task SendAsync(JObject envelope) =>
            await socket!.SendAsync(Encoding.UTF8.GetBytes(envelope.ToString()), WebSocketMessageType.Text, true, CancellationToken.None);

        private async Task<JObject> ReceiveAsync(CancellationToken cancellationToken)
        {
            var buffer = new byte[16384];
            using var message = new MemoryStream();
            WebSocketReceiveResult received;
            do
            {
                received = await socket!.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                message.Write(buffer, 0, received.Count);
            } while (!received.EndOfMessage);
            return JObject.Parse(Encoding.UTF8.GetString(message.ToArray()));
        }

        public ValueTask DisposeAsync()
        {
            foreach (var item in sockets) item.Dispose();
            foreach (var item in connections) item.Dispose();
            listener.Stop();
            return ValueTask.CompletedTask;
        }
    }
}
