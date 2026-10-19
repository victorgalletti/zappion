// SPDX-License-Identifier: AGPL-3.0-only
using System.Net;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class TemplateTransportTests
{
    [Fact]
    public async Task ForcedRefreshAndMutationsUseNetworkAndInvalidateTheSharedLists()
    {
        using var server = new Server();
        using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-key"));
        var changes = new List<(string, string)>();
        client.TemplatesChanged += (org, address) => changes.Add((org, address));
        var first = client.GetAllTemplatesAsync("org", "number");
        await server.Respond((_, _) => JObject.Parse("{data:[{name:'old',status:'APPROVED'}]}"));
        await first;
        var forced = client.GetAllTemplatesAsync("org", "number", true);
        Assert.False(forced.IsCompleted);
        await server.Respond((headers, _) =>
        {
            Assert.StartsWith("PUT /functions/v1/whatsapp-management/templates", headers[0]);
            return JObject.Parse("{data:[{name:'new',status:'PENDING'}]}");
        });
        Assert.Equal("new", (string?)(await forced)[0]["name"]);
        Assert.Empty(await client.GetTemplatesAsync("org", "number"));
        Assert.Equal(new[] { ("org", "number"), ("org", "number") }, changes);

        var create = client.CreateTemplateAsync(JObject.Parse("{organization_id:'org',organization_address:'number',name:'created'}"));
        await server.Respond((headers, _) =>
        {
            Assert.StartsWith("POST /functions/v1/whatsapp-management/templates", headers[0]);
            return new JObject();
        });
        await create;
        var afterCreate = client.GetTemplatesAsync("org", "number");
        await server.Respond((_, _) => JObject.Parse("{data:[{name:'created',status:'APPROVED'}]}"));
        Assert.Single(await afterCreate);

        var delete = client.DeleteTemplateAsync("org", "number", new JObject { ["name"] = "created" });
        await server.Respond((headers, body) =>
        {
            Assert.StartsWith("DELETE /functions/v1/whatsapp-management/templates", headers[0]);
            Assert.Equal("org", (string?)body["organization_id"]);
            Assert.Equal("number", (string?)body["organization_address"]);
            Assert.Equal("created", (string?)body["template"]?["name"]);
            return JObject.Parse("{success:true}");
        });
        await delete;
        var afterDelete = client.GetAllTemplatesAsync("org", "number");
        await server.Respond((_, _) => JObject.Parse("{data:[]}"));
        Assert.Empty(await afterDelete);
    }

    [Fact]
    public async Task EdgeFunctionsUseUserBearerPutPathAndPerBusinessCache()
    {
        using var server = new Server();
        using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-anon-key"));
        var signIn = client.SignInAsync("agent@example.invalid", "test-password");
        await server.Respond((headers, _) =>
        {
            Assert.StartsWith("POST /auth/v1/token?grant_type=password", headers[0]);
            return JObject.Parse("{access_token:'user-bearer-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'user'}}");
        });
        await signIn;
        var pending = client.GetTemplatesAsync("organization", "number-one");
        await server.Respond((headers, body) =>
        {
            Assert.StartsWith("PUT /functions/v1/whatsapp-management/templates", headers[0]);
            Assert.Contains(headers, h => h == "Authorization: Bearer user-bearer-token");
            Assert.True(JToken.DeepEquals(JObject.Parse("{organization_id:'organization',organization_address:'number-one'}"), body));
            return JObject.Parse("{data:[{name:'approved',status:'APPROVED'},{name:'pending',status:'PENDING'}]}");
        });
        var result = await pending;
        Assert.Single(result); Assert.Equal("approved", (string?)result[0]["name"]);
        Assert.Same(result, await client.GetTemplatesAsync("organization", "number-one").WaitAsync(TimeSpan.FromSeconds(1)));
        pending = client.GetTemplatesAsync("organization", "number-two");
        await server.Respond((_, body) => { Assert.Equal("number-two", (string?)body["organization_address"]); return JObject.Parse("{data:[]}"); });
        Assert.Empty(await pending);
    }
    [Fact]
    public async Task LastIncomingIsASeparateLimitOneQueryAcrossMergedMembers()
    {
        using var server = new Server(); using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-key"));
        var pending = client.GetLastIncomingAsync(["one", "two"]);
        await server.Respond((headers, _) =>
        {
            var path = Uri.UnescapeDataString(headers[0]).Replace("\"", "", StringComparison.Ordinal);
            Assert.Contains("conversation_id=in.(one,two)", path);
            Assert.Contains("sender_address=not.is.null", path); Assert.Contains("limit=1", path); Assert.Contains("order=timestamp.desc", path);
            return JArray.Parse("[{id:'old-incoming',sender_address:'customer',timestamp:'2026-10-15T12:00:00Z'}]");
        });
        Assert.Equal("old-incoming", (await pending)?.Id);
    }
    [Fact]
    public async Task TemplatesManagerListsAllStatusesCreatesTemplateAndUploadsSampleWithoutRealMeta()
    {
        using var server = new Server();
        using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-anon-key"));
        var signIn = client.SignInAsync("agent@example.invalid", "test-password");
        await server.Respond((_, _) => JObject.Parse("{access_token:'user-bearer-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'user'}}"));
        await signIn;

        var listTask = client.GetAllTemplatesAsync("org-1", "5511999999999");
        await server.Respond((headers, body) =>
        {
            Assert.StartsWith("PUT /functions/v1/whatsapp-management/templates", headers[0]);
            Assert.Equal("org-1", (string?)body["organization_id"]);
            return JObject.Parse("{data:[{name:'approved_tpl',status:'APPROVED'},{name:'pending_tpl',status:'PENDING'},{name:'rejected_tpl',status:'REJECTED',rejected_reason:'PROMOTIONAL'}]}");
        });
        var all = await listTask;
        Assert.Equal(3, all.Count);
        var approvedOnly = await client.GetTemplatesAsync("org-1", "5511999999999");
        Assert.Single(approvedOnly);

        var draft = Templates.NewDraft("standard");
        draft.Name = "welcome_new";
        draft.Body.Text = "Olá {{1}}, bem-vindo!";
        draft.Body.Examples["1"] = "Maria";
        var createPayload = Templates.BuildCreatePayload(draft, "org-1", "5511999999999");
        var createTask = client.CreateTemplateAsync(createPayload);
        await server.Respond((headers, body) =>
        {
            Assert.StartsWith("POST /functions/v1/whatsapp-management/templates", headers[0]);
            Assert.Equal("welcome_new", (string?)body["name"]);
            Assert.Equal("MARKETING", (string?)body["category"]);
            return JObject.Parse("{id:'tpl-123',status:'PENDING',category:'MARKETING'}");
        });
        var created = await createTask;
        Assert.Equal("PENDING", (string?)created["status"]);

        var uploadTask = client.UploadTemplateSampleAsync("org-1", [1, 2, 3, 4], "sample.png", "image/png", "IMAGE");
        await server.RespondRaw((headers, rawBody) =>
        {
            Assert.StartsWith("POST /functions/v1/whatsapp-management/template-media?organization_id=org-1", headers[0]);
            Assert.Contains(headers, h => h.StartsWith("Content-Type: multipart/form-data", StringComparison.OrdinalIgnoreCase));
            Assert.Contains("sample.png", rawBody);
            return JObject.Parse("{handle:'4::aW1hZ2U='}");
        });
        Assert.Equal("4::aW1hZ2U=", await uploadTask);
    }
    internal sealed class Server : IDisposable
    {
        private readonly TcpListener listener = new(IPAddress.Loopback, 0);
        public string Url => $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}";
        public Server() => listener.Start();
        public Task Respond(Func<string[], JToken, JToken> inspect) =>
            RespondRaw((headers, raw) => inspect(headers, raw.Length > 0 ? JToken.Parse(raw) : new JObject()));
        public async Task RespondRaw(Func<string[], string, JToken> inspect)
        {
            using var connection = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(10));
            await using var stream = connection.GetStream(); using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var bytes = new List<byte>(); var single = new byte[1];
            while (!Encoding.ASCII.GetString(bytes.ToArray()).EndsWith("\r\n\r\n", StringComparison.Ordinal))
            {
                if (await stream.ReadAsync(single, timeout.Token) == 0) throw new IOException(); bytes.Add(single[0]);
            }
            var headers = Encoding.ASCII.GetString(bytes.ToArray()).Split("\r\n");
            var length = headers.FirstOrDefault(h => h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))?.Split(':')[1];
            var body = new byte[length is null ? 0 : int.Parse(length)]; await stream.ReadExactlyAsync(body, timeout.Token);
            var response = inspect(headers, Encoding.UTF8.GetString(body));
            var payload = Encoding.UTF8.GetBytes(response.ToString());
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {payload.Length}\r\nConnection: close\r\n\r\n"), timeout.Token);
            await stream.WriteAsync(payload, timeout.Token);
        }
        public void Dispose() => listener.Stop();
    }
}
