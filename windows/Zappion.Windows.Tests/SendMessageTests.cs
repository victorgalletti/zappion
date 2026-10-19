// SPDX-License-Identifier: AGPL-3.0-only
using System.Net;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class SendMessageTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InsertMatchesWebAndMapsReturnedServerDefaults(bool draft)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var url = $"http://127.0.0.1:{port}/";
        using var client = IsolatedClient.Create(new AppConfiguration(url.TrimEnd('/'), "test-key"));
        var workspace = new Workspace(new AgentRow { Id = "agent", OrganizationId = "organization" }, "Test", []);
        var conversation = new ConversationRow { Id = draft ? "" : "primary", Address = "recipient", OrganizationAddress = "business" };
        var pending = client.SendTextAsync(workspace, conversation, "*bold*\n`*literal*`");
        using var connection = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(10));
        await using var stream = connection.GetStream();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var headerBytes = new List<byte>();
        var single = new byte[1];
        while (!Encoding.ASCII.GetString(headerBytes.ToArray()).EndsWith("\r\n\r\n", StringComparison.Ordinal))
        {
            if (await stream.ReadAsync(single, timeout.Token) == 0) throw new IOException("Incomplete HTTP request.");
            headerBytes.Add(single[0]);
        }
        var headers = Encoding.ASCII.GetString(headerBytes.ToArray()).Split("\r\n");
        Assert.StartsWith("POST /rest/v1/messages", headers[0]);
        Assert.Contains(headers, h => h.StartsWith("Prefer:", StringComparison.OrdinalIgnoreCase) && h.Contains("return=representation"));
        var length = int.Parse(headers.Single(h => h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)).Split(':')[1]);
        var body = new byte[length];
        await stream.ReadExactlyAsync(body, timeout.Token);
        var payload = JObject.Parse(Encoding.UTF8.GetString(body));
        Assert.True(Guid.TryParse((string?)payload["id"], out _));
        Assert.Equal(new[] { "agent_id", "content", "conversation_address", "conversation_id", "id", "organization_address", "organization_id", "sender_address", "service" },
            (draft ? payload.Properties().Select(p => p.Name).Append("conversation_id") : payload.Properties().Select(p => p.Name)).OrderBy(n => n, StringComparer.Ordinal));
        Assert.Equal("organization", (string?)payload["organization_id"]);
        Assert.Equal("business", (string?)payload["organization_address"]);
        Assert.Equal("recipient", (string?)payload["conversation_address"]);
        if (draft) Assert.Null(payload.Property("conversation_id"));
        else Assert.Equal("primary", (string?)payload["conversation_id"]);
        Assert.Equal("agent", (string?)payload["agent_id"]);
        Assert.Equal("whatsapp", (string?)payload["service"]);
        Assert.Equal(JTokenType.Null, payload["sender_address"]!.Type);
        Assert.True(JToken.DeepEquals(JObject.Parse("{version:'1',type:'text',kind:'text',text:'**bold**\\n`*literal*`'}"), payload["content"]));
        payload["conversation_id"] = "primary";
        payload["timestamp"] = "2026-10-15T12:00:00Z";
        payload["status"] = new JObject { ["pending"] = "2026-10-15T12:00:00Z" };
        var bytes = Encoding.UTF8.GetBytes(new JArray(payload).ToString());
        var responseHeaders = Encoding.ASCII.GetBytes($"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(responseHeaders, timeout.Token);
        await stream.WriteAsync(bytes, timeout.Token);
        var returned = await pending.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal((string?)payload["id"], returned.Id);
        Assert.Equal("primary", returned.ConversationId);
        Assert.Equal("business", returned.OrganizationAddress);
        Assert.Equal("2026-10-15T12:00:00Z", returned.Timestamp);
        Assert.Equal("sending", ChatHelpers.DeliveryState(returned.Status));
    }
}
