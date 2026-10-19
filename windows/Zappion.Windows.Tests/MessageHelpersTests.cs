// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class MessageHelpersTests
{
    [Theory]
    [InlineData("551199887766", "551199887766")]
    [InlineData("+55 (11) 99988-7766", "551199887766")]
    [InlineData("5511988887766", "551188887766")]
    [InlineData("551132345678", "551132345678")]
    [InlineData("12025551234", "12025551234")]
    [InlineData("unknown", "unknown")]
    [InlineData("", "")]
    public void PhoneKeyNormalizesOnlyBrazilianMobiles(string input, string expected) =>
        Assert.Equal(expected, MessageHelpers.PhoneKey(input));

    [Theory]
    [InlineData("551199887766", "+55 11 99988-7766")]
    [InlineData("+55 (11) 99988-7766", "+55 11 99988-7766")]
    [InlineData("551132345678", "+55 11 3234-5678")]
    [InlineData("+1 (202) 555-1234", "+12025551234")]
    [InlineData("123", "123")]
    [InlineData("unknown", "unknown")]
    public void FormatPhoneAddsNineOnlyToMobiles(string input, string expected) =>
        Assert.Equal(expected, MessageHelpers.FormatPhone(input));

    [Theory]
    [InlineData("{name:'Push',saved_name:'Saved',synced:{name:'Address book'}}", "Address book")]
    [InlineData("{name:'Push',saved_name:'Saved'}", "Saved")]
    [InlineData("{name:'Push'}", "Push")]
    [InlineData("{saved_name:'Saved'}", "Saved")]
    [InlineData("{name:'New push',saved_name:'Saved'}", "Saved")]
    [InlineData("{name:'Push',saved_name:'Saved',synced:{name:''}}", "")]
    [InlineData("{name:'Push',saved_name:null,synced:null}", "Push")]
    [InlineData("{}", null)]
    [InlineData(null, null)]
    public void ContactNameMirrorsWebPrecedence(string? json, string? expected) =>
        Assert.Equal(expected, MessageHelpers.ContactName(json is null ? null : JObject.Parse(json)));

    [Theory]
    [InlineData("{type:'text',kind:'text',text:'**Bold** *italic* ~~strike~~'}", "*Bold* _italic_ ~strike~", null)]
    [InlineData("{type:'text',text:'`**code**` and **bold**'}", "`**code**` and *bold*", null)]
    [InlineData("{type:'file',kind:'audio',file:{duration:65.6}}", "Voice message (1:06)", "voice")]
    [InlineData("{type:'file',kind:'audio',file:{}}", "Voice message", "voice")]
    [InlineData("{type:'file',kind:'image',text:'**Caption**'}", "*Caption*", "image")]
    [InlineData("{type:'file',kind:'image'}", "Photo", "image")]
    [InlineData("{type:'file',kind:'video'}", "Video", "video")]
    [InlineData("{type:'file',kind:'video',text:'Caption'}", "Caption", "video")]
    [InlineData("{type:'file',kind:'sticker',text:'Ignored'}", "Sticker", "sticker")]
    [InlineData("{type:'file',kind:'document',file:{name:'invoice.pdf'}}", "invoice.pdf", "document")]
    [InlineData("{type:'file',kind:'document',text:'Caption',file:{name:'invoice.pdf'}}", "Caption", "document")]
    [InlineData("{type:'file',kind:'other'}", "Document", "document")]
    [InlineData("{type:'data',kind:'template',data:{name:'welcome'}}", "welcome", "template")]
    [InlineData("{type:'data',kind:'template'}", "Template", "template")]
    [InlineData("{type:'data',kind:'location'}", "Location", "location")]
    [InlineData("{type:'data',kind:'contacts'}", "Contact", "contact")]
    [InlineData("{type:'unknown',text:'Fallback'}", "Fallback", null)]
    [InlineData("{type:'unknown'}", "Message", null)]
    public void PreviewHandlesMessageKinds(string json, string text, string? icon) =>
        Assert.Equal(new MessagePreview(text, icon), MessageHelpers.Preview(new MessageRow { Content = JObject.Parse(json) }));

    [Fact]
    public void MissingMessageHasEmptyPreview() => Assert.Equal("", MessageHelpers.Preview(null).Text);

    [Theory]
    [InlineData(null, false)]
    [InlineData("{kind:'reaction',type:'text',text:'like'}", false)]
    [InlineData("{type:'text',text:''}", false)]
    [InlineData("{type:'text',text:null}", false)]
    [InlineData("{type:'text',text:' '}", true)]
    [InlineData("{type:'text'}", true)]
    [InlineData("{type:'file',kind:'image'}", true)]
    public void RenderabilityMatchesWeb(string? json, bool expected) =>
        Assert.Equal(expected, MessageHelpers.IsRenderable(new MessageRow { Content = json is null ? null : JObject.Parse(json) }));
}
