// SPDX-License-Identifier: AGPL-3.0-only
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class SettingsTests
{
    private static ManualConnectFields Valid => new(PhoneNumberId: "123", WabaId: "456", AccessToken: "test-secret");
    [Fact]
    public void ManualValidationMatchesWebAndSystemTokenFallback()
    {
        Assert.Null(SettingsRules.ValidateManualConnect(Valid));
        Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { PhoneNumberId = "\u0661\u0662\u0663" }));
        Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { WabaId = "1a" }));
        Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { AccessToken = " " }));
        Assert.Null(SettingsRules.ValidateManualConnect(Valid with { AccessToken = " " }, true));
        Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { Register = true, Pin = " 12345" }));
        Assert.Null(SettingsRules.ValidateManualConnect(Valid with { Register = true, Pin = "123456" }));
        Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { Label = new string('a', 101) }));
        Assert.Null(SettingsRules.ValidateManualConnect(Valid with { Label = " " + new string('a', 100) + " " }));
    }
    [Theory]
    [InlineData("http://example.com")]
    [InlineData("https://user:password@example.com")]
    [InlineData("https://user@example.com")]
    [InlineData("not a url")]
    public void CallbackRejectsInsecureOrCredentialedUrls(string callback) => Assert.NotNull(SettingsRules.ValidateManualConnect(Valid with { CallbackUrl = callback }));
    [Fact]
    public void PayloadTrimsOptionalFieldsAndOmitsUnusedSecrets()
    {
        var payload = SettingsRules.ManualPayload("org", Valid with { PhoneNumberId = " 123 ", AccessToken = " ", Pin = "unused", Label = " Test ", VerifyToken = " " });
        Assert.Equal("123", (string?)payload["phone_number_id"]); Assert.Equal("Test", (string?)payload["label"]);
        Assert.Null(payload["pin"]); Assert.Null(payload["verify_token"]); Assert.Null(payload["access_token"]); Assert.False((bool)payload["register"]!);
    }
    [Fact]
    public void ManualErrorsRedactBeforeClassifyingAndTranslateKnownFailures()
    {
        Assert.DoesNotContain("sensitive", SettingsRules.ManualError("failed: sensitive", "sensitive"));
        Assert.DoesNotContain("private", SettingsRules.ManualError("failed: private-long", "private", "private-long"));
        Assert.Equal(SettingsRules.Text("manualConnect", "invalidOrExpiredTokenCheckThePermanentSystem"), SettingsRules.ManualError("HTTP 401"));
        Assert.Equal(SettingsRules.Text("manualConnect", "incorrectPinCheckTheNumberS6Digit"), SettingsRules.ManualError("133005"));
        Assert.Equal(SettingsRules.Text("manualConnect", "theNumberDoesNotBelongToTheSpecified"), SettingsRules.ManualError("number does not belong to WABA"));
    }
    [Theory]
    [InlineData("image/png", 2097152, "png")]
    [InlineData("image/jpeg", 1, "jpg")]
    [InlineData("image/webp", 1, "webp")]
    [InlineData("image/gif", 1, null)]
    [InlineData("image/png", 2097153, null)]
    public void LogoMatchesMediaBucketLimits(string type, long length, string? extension) => Assert.Equal(extension, SettingsRules.LogoExtension(type, length));
    [Fact]
    public void PermissionsProtectLastOwnerAndSeparateAdministration()
    {
        Assert.True(SettingsRules.CanEdit("admin")); Assert.False(SettingsRules.CanEdit("member")); Assert.False(SettingsRules.CanEdit("unexpected"));
        Assert.False(SettingsRules.CanManageMembers("admin")); Assert.True(SettingsRules.CanManageMembers("owner"));
        Assert.False(SettingsRules.CanChangeMember("owner", "owner", 1)); Assert.True(SettingsRules.CanChangeMember("owner", "owner", 2)); Assert.False(SettingsRules.CanChangeMember("admin", "member", 2));
    }
    [Fact]
    public void InstanceSearchNormalizesAccentsPhonePunctuationAndStatus()
    {
        var number = new OrganizationAddressRow { Address = "1234", Status = "connected", Extra = JObject.Parse("{label:'S\\u00e3o Paulo',phone_number:'+55 (11) 99999-0000',waba_id:'999'}") };
        Assert.True(SettingsRules.MatchesInstance(number, "sao", "all")); Assert.True(SettingsRules.MatchesInstance(number, "+55 11 99999", "connected")); Assert.True(SettingsRules.MatchesInstance(number, "999", "all")); Assert.False(SettingsRules.MatchesInstance(number, "sao", "disconnected"));
    }
    [Fact]
    public void KeysValidateConnectedSelectionAndExpireAtBoundary()
    {
        Assert.True(SettingsRules.ValidKey("test", "send", 30, 0, ["one"], ["one"]));
        Assert.False(SettingsRules.ValidKey("test", "send", 30, 0, [], ["one"])); Assert.False(SettingsRules.ValidKey("test", "send", 30, 0, ["other"], ["one"])); Assert.False(SettingsRules.ValidKey("test", "send", 0, 0, null, []));
        var now = DateTimeOffset.Parse("2026-10-16T00:00:00Z"); var key = JObject.Parse("{expires_at:'2026-10-16T00:00:00Z'}"); Assert.Equal("expired", SettingsRules.KeyState(key, now)); key["revoked_at"] = now.ToString("O"); Assert.Equal("revoked", SettingsRules.KeyState(key, now));
    }
    [Fact]
    public void DateFormattingSupportsBothNewtonsoftDateAndStringTokens()
    {
        var local15 = new DateTimeOffset(2026, 10, 15, 21, 59, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 10, 15, 21, 59, 0)));
        var local16 = new DateTimeOffset(2026, 10, 16, 11, 12, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 10, 16, 11, 12, 0)));
        var utc15 = local15.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        var utc16 = local16.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        var parsedObj = JObject.Parse($"{{\"created_at\":\"{utc15}\",\"last_used_at\":\"{utc16}\",\"expires_at\":null}}");
        Assert.Equal(JTokenType.Date, parsedObj["created_at"]!.Type);
        Assert.Equal(JTokenType.Date, parsedObj["last_used_at"]!.Type);

        using var reader = new JsonTextReader(new StringReader($"{{\"created_at\":\"{utc15}\",\"last_used_at\":\"{utc16}\"}}")) { DateParseHandling = DateParseHandling.None };
        var stringObj = JObject.Load(reader);
        Assert.Equal(JTokenType.String, stringObj["created_at"]!.Type);
        Assert.Equal(JTokenType.String, stringObj["last_used_at"]!.Type);

        var pt = CultureInfo.GetCultureInfo("pt-BR");
        var en = CultureInfo.GetCultureInfo("en-US");
        Assert.Equal("15 de out., 21:59", SettingsRules.FormatDate(parsedObj["created_at"], pt));
        Assert.Equal("15 de out., 21:59", SettingsRules.FormatDate(stringObj["created_at"], pt));
        Assert.Equal("16 de out., 11:12", SettingsRules.FormatDate(parsedObj["last_used_at"], pt));
        Assert.Equal("16 de out., 11:12", SettingsRules.FormatDate(stringObj["last_used_at"], pt));
        Assert.Equal("Oct 15, 21:59", SettingsRules.FormatDate(parsedObj["created_at"], en));
        Assert.Equal("Oct 15, 21:59", SettingsRules.FormatDate(stringObj["created_at"], en));
        Assert.Equal("Oct 16, 11:12", SettingsRules.FormatDate(parsedObj["last_used_at"], en));
        Assert.Equal("Oct 16, 11:12", SettingsRules.FormatDate(stringObj["last_used_at"], en));
        Assert.Equal(SettingsRules.Text("integrations", "never"), SettingsRules.FormatDate(parsedObj["expires_at"], pt));
        Assert.Equal(SettingsRules.Text("integrations", "never"), SettingsRules.FormatDate(null, en));
        Assert.Equal("expired", SettingsRules.KeyState(new JObject { ["expires_at"] = stringObj["created_at"] }, local16));
        Assert.Equal("expired", SettingsRules.KeyState(new JObject { ["expires_at"] = parsedObj["created_at"] }, local16));
    }
    [Fact]
    public async Task TransportUsesExactWebRpcAndSparseOrganizationPatch()
    {
        using var server = new TemplateTransportTests.Server(); using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-public-key"));
        var w = new Workspace(new AgentRow { OrganizationId = "org", Role = "owner" }, "Organization", [new OrganizationAddressRow { Address = "number", Service = "whatsapp", Status = "connected" }]);
        var request = client.CreateApiKeyAsync(w, " Fixture ", "send", null, ["number"], 30, 0);
        await server.Respond((headers, body) => {
            Assert.StartsWith("POST /rest/v1/rpc/zappion_create_api_key", headers[0]); Assert.Contains(headers, h => h == "apikey: test-public-key");
            Assert.Equal("org", (string?)body["p_organization_id"]); Assert.Equal("Fixture", (string?)body["p_name"]); Assert.Equal(0, (int)body["p_template_limit_per_hour"]!); return JObject.Parse("{id:'fixture',key:'test-only-key'}");
        });
        Assert.Equal("test-only-key", (string?)(await request)["key"]);
        var patch = client.UpdateOrganizationNameAsync(w, " New name ");
        await server.Respond((headers, body) => { Assert.StartsWith("PATCH /rest/v1/organizations?id=eq.org&select=id", headers[0]); Assert.Single((JObject)body); Assert.Equal("New name", (string?)body["name"]); return JObject.Parse("{id:'org'}"); }); await patch;
    }
    [Fact]
    public async Task MemberCannotInvokePrivilegedOperations()
    {
        using var client = IsolatedClient.Create(new AppConfiguration("http://127.0.0.1:1", "test")); var w = new Workspace(new AgentRow { Role = "member" }, "", []);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => client.GetApiKeysAsync(w)); await Assert.ThrowsAsync<UnauthorizedAccessException>(() => client.SaveMetaAppAsync(w, "1")); await Assert.ThrowsAsync<UnauthorizedAccessException>(() => client.RemoveMemberAsync(w, "id"));
    }
    [Theory]
    [InlineData("Claude Desktop")]
    [InlineData("Cursor")]
    [InlineData("OpenAI API")]
    public void McpConfigurationEscapesKeysAndUrls(string name)
    {
        var snippet = SettingsSnippets.Mcp(name, "https://example.com/functions/v1/mcp", "test-\"quoted"); Assert.NotNull(JObject.Parse(snippet));
    }
}
