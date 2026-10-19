// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class ConversationPreferenceTests
{
    [Fact]
    public void PartialArchivesKeepNewMergedMembersAndDoNotAffectOtherBusinessNumber()
    {
        var merged = new ConversationView(new ConversationRow { Id = "new", OrganizationAddress = "one" }, ["old", "new"], "Customer", null);
        var other = new ConversationView(new ConversationRow { Id = "other", OrganizationAddress = "two" }, ["other"], "Same customer", null);
        var rows = ConversationPreferences.Rows("member", "org", ["old", "old"], "2026-10-16T12:00:00Z");
        Assert.Single(rows);
        var views = ConversationPreferences.Apply([merged, other], rows);
        Assert.True(views[0].Archived); Assert.False(views[1].Archived);
        Assert.False(merged.Archived);
        Assert.All(ConversationPreferences.Apply([merged, other], ConversationPreferences.Rows("member", "org", ["old"], null)), c => Assert.False(c.Archived));
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ArchiveTransportUsesEveryDistinctMemberOwnAgentConflictKeyAndExplicitNull(bool archived)
    {
        using var server = new TemplateTransportTests.Server(); using var client = IsolatedClient.Create(new AppConfiguration(server.Url, "test-key"));
        var workspace = new Workspace(new AgentRow { Id = "member", OrganizationId = "org" }, "Organization", []);
        var conversation = new ConversationView(new ConversationRow { Id = "primary" }, ["primary", "alias", "primary"], "Customer", null);
        var pending = client.ArchiveAsync(workspace, conversation, archived);
        await server.Respond((headers, body) => {
            Assert.Contains("on_conflict=agent_id,conversation_id", Uri.UnescapeDataString(headers[0]));
            Assert.Contains(headers, h => h.StartsWith("Prefer:") && h.Contains("resolution=merge-duplicates"));
            var rows = Assert.IsType<JArray>(body); Assert.Equal(2, rows.Count);
            Assert.All(rows, row => {
                Assert.Equal("member", (string?)row["agent_id"]); Assert.Equal("org", (string?)row["organization_id"]);
                if (archived) Assert.True(DateTimeOffset.TryParse(row["archived_at"]!.ToString(), out _));
                else Assert.Equal(JTokenType.Null, row["archived_at"]!.Type);
            });
            Assert.Equal(new[] { "primary", "alias" }, rows.Select(r => (string?)r["conversation_id"])); return rows;
        });
        await pending;
    }
}
