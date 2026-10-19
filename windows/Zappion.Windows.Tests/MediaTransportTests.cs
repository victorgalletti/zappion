// SPDX-License-Identifier: AGPL-3.0-only
using System.Net;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class MediaTransportTests
{
    [Fact]
    public async Task UploadPrecedesInsertAndUsesTheWebStoragePathAndVoicePayload()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        using var client = IsolatedClient.Create(new AppConfiguration($"http://127.0.0.1:{port}", "test-key"));
        var workspace = new Workspace(new AgentRow { Id = "agent", OrganizationId = "org" }, "Test", []);
        var conversation = new ConversationRow { Id = "chat", Address = "contact", OrganizationAddress = "business" };
        var bytes = Encoding.ASCII.GetBytes("OggS synthetic transport fixture");
        var pending = client.SendFileAsync(workspace, conversation, bytes, "audio.ogg", MediaContent.OpusMime, duration: 4);
        string path = "";
        await Respond(async (headers, body) =>
        {
            Assert.StartsWith("POST /storage/v1/object/media/organizations/org/attachments/", headers[0]);
            path = headers[0].Split(' ')[1]["/storage/v1/object/media/".Length..];
            Assert.True(Guid.TryParse(path.Split('/').Last(), out _));
            Assert.Contains("audio/ogg; codecs=opus", string.Join("\n", headers) + Encoding.ASCII.GetString(body));
            Assert.Contains(Encoding.ASCII.GetString(bytes), Encoding.ASCII.GetString(body));
            return await Task.FromResult(new JObject { ["Key"] = "media/" + path });
        });
        await Respond(async (headers, body) =>
        {
            Assert.StartsWith("POST /rest/v1/messages", headers[0]);
            var row = JObject.Parse(Encoding.UTF8.GetString(body));
            Assert.Equal("chat", (string?)row["conversation_id"]);
            Assert.Equal("org", (string?)row["organization_id"]);
            Assert.Equal("business", (string?)row["organization_address"]);
            Assert.Equal("contact", (string?)row["conversation_address"]);
            Assert.Equal("agent", (string?)row["agent_id"]);
            Assert.Null(row["sender_address"]?.Value<string>());
            Assert.True(JToken.DeepEquals(MediaContent.Create(path, MediaContent.OpusMime, bytes.Length, "audio.ogg", duration: 4), row["content"]));
            row["timestamp"] = "2026-10-16T00:00:00Z";
            return await Task.FromResult<JToken>(new JArray(row));
        });
        Assert.Equal("chat", (await pending.WaitAsync(TimeSpan.FromSeconds(10))).ConversationId);

        async Task Respond(Func<string[], byte[], Task<JToken>> inspect)
        {
            using var connection = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(10));
            await using var stream = connection.GetStream();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var header = new List<byte>(); var single = new byte[1];
            while (!Encoding.ASCII.GetString(header.ToArray()).EndsWith("\r\n\r\n", StringComparison.Ordinal))
            {
                await stream.ReadExactlyAsync(single, timeout.Token); header.Add(single[0]);
            }
            var headers = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n");
            var size = int.Parse(headers.Single(h => h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)).Split(':')[1]);
            var body = new byte[size]; await stream.ReadExactlyAsync(body, timeout.Token);
            var response = Encoding.UTF8.GetBytes((await inspect(headers, body)).ToString());
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {response.Length}\r\nConnection: close\r\n\r\n"), timeout.Token);
            await stream.WriteAsync(response, timeout.Token);
        }
    }
}
