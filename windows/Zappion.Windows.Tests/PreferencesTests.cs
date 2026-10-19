// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class PreferencesTests
{
    [Theory]
    [InlineData("text", "text", true)]
    [InlineData("file", "image", true)]
    [InlineData("file", "video", true)]
    [InlineData("file", "document", true)]
    [InlineData("file", "audio", false)]
    [InlineData("file", "voice", false)]
    [InlineData("template", "template", false)]
    [InlineData("text", "reaction", false)]
    public void SignatureMatchesWebAndNeverMutatesOrDuplicates(string type, string kind, bool signed)
    {
        var content = new JObject { ["type"] = type, ["kind"] = kind, ["text"] = "**Hello**", ["re_message_id"] = "quoted" };
        var preferences = new DevicePreferences { SignatureEnabled = true, SignatureName = " Agent " };
        var result = preferences.Sign(content, "Fallback");
        Assert.Equal(signed ? "**Agent:**\n**Hello**" : "**Hello**", (string?)result["text"]);
        Assert.Equal("**Hello**", (string?)content["text"]);
        Assert.Equal("quoted", (string?)result["re_message_id"]);
        Assert.Same(result, preferences.Sign(result, "Fallback"));
    }
    [Fact]
    public void SignatureFallsBackToMemberAndLeavesEmptyOrDisabledAlone()
    {
        var content = JObject.Parse("{type:'text',kind:'text',text:'Hello'}");
        Assert.Same(content, new DevicePreferences().Sign(content, "Agent"));
        var preferences = new DevicePreferences { SignatureEnabled = true, SignatureName = " " };
        Assert.Equal("**Agent:**\nHello", (string?)preferences.Sign(content, " Agent ")["text"]);
        content["text"] = ""; Assert.Same(content, preferences.Sign(content, "Agent"));
    }
    [Fact]
    public void DeviceSettingsRoundTripAndValidateWithoutAccessingOwnerFiles()
    {
        var directory = Path.Combine(Path.GetTempPath(), "zappion-preferences-" + Guid.NewGuid());
        var path = Path.Combine(directory, "preferences.json"); var store = new PreferencesStore(path);
        try {
            var settings = new DevicePreferences { Theme = "dark", Language = "pt-BR", Instance = "number-two", EnterToSend = false, AudioRate = 1.5, SignatureEnabled = true };
            store.Save(settings); Assert.Equal(settings, new PreferencesStore(path).Load());
            File.WriteAllText(path, "{\"language\":\"pt-BR\",\"enterToSend\":\"invalid\",\"fontSize\":\"large\"}");
            Assert.Equal("pt-BR", store.Load().Language); Assert.Equal("large", store.Load().FontSize); Assert.True(store.Load().EnterToSend);
            File.WriteAllText(path, "{broken"); Assert.Equal("system", store.Load().Theme);
            Assert.Equal("default", (settings with { FontSize = "invalid" }).Validated().FontSize);
            Assert.Equal(1, (settings with { AudioRate = 3 }).Validated().AudioRate);
            Assert.Equal("", (settings with { SignatureName = new string('x', 41) }).Validated().SignatureName);
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
    [Theory]
    [InlineData("5511998877665", "+55 (11) 98877-665", true)]
    [InlineData("5511998877665", "551198877665", true)]
    [InlineData("551198877665", "5511998877665", true)]
    [InlineData("551198877665", "77665", true)]
    [InlineData("551198877665", "123456", false)]
    public void PhoneSearchIgnoresFormattingAndBrazilianNinthDigit(string address, string query, bool expected) => Assert.Equal(expected, ConversationSearch.PhoneMatches(address, query));
    [Fact]
    public void MessageSearchUsesNewestFirstTwoCharactersTemplatesAndNoReactions()
    {
        var rows = new[] {
            new MessageRow { Id = "one", Content = JObject.Parse("{kind:'text',text:'Hello world'}") },
            new MessageRow { Id = "reaction", Content = JObject.Parse("{kind:'reaction',text:'Hello'}") },
            new MessageRow { Id = "two", Content = JObject.Parse("{kind:'template',data:{name:'welcome'}}") } };
        JObject[] templates = [JObject.Parse("{name:'welcome',components:[{type:'BODY',text:'HELLO customer'}]}")];
        Assert.Equal(new[] { "two", "one" }, ConversationSearch.Messages(rows, " hello ", templates));
        Assert.Empty(ConversationSearch.Messages(rows, "h", templates));
    }
    [Fact]
    public void TaskbarFlashingDefaultsOnAndPersistsWhenTurnedOff()
    {
        var path = Path.Combine(Path.GetTempPath(), "zappion-preferences-" + Guid.NewGuid(), "preferences.json");
        try
        {
            var store = new PreferencesStore(path);
            Assert.True(store.Load().FlashTaskbar);
            store.Save(new DevicePreferences { FlashTaskbar = false });
            Assert.False(store.Load().FlashTaskbar);
        }
        finally { Directory.Delete(Path.GetDirectoryName(path)!, true); }
    }
    [Fact]
    public void NotificationToneIsTheWebAppsTwoBlipWave()
    {
        var wave = NotificationTone.CreateWave();
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(wave, 0, 4));
        Assert.Equal("WAVE", System.Text.Encoding.ASCII.GetString(wave, 8, 4));
        Assert.Equal(wave.Length - 8, BitConverter.ToInt32(wave, 4));
        var samples = Enumerable.Range(0, (wave.Length - 44) / 2).Select(i => BitConverter.ToInt16(wave, 44 + i * 2)).ToArray();
        Assert.Equal((int)(NotificationTone.SampleRate * 0.23), samples.Length);
        Assert.All(samples, s => Assert.InRange(Math.Abs((int)s), 0, (int)(0.035 * short.MaxValue) + 1));
        int At(double seconds) => (int)(seconds * NotificationTone.SampleRate);
        Assert.All(samples[At(0.1)..At(0.12)], s => Assert.Equal(0, s));
        Assert.Contains(samples[At(0.12)..At(0.22)], s => Math.Abs((int)s) > 1000);
    }
}
