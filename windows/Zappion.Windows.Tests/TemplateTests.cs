// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json.Linq;
using Xunit;
using Zappion.Windows.Core;

namespace Zappion.Windows.Tests;

public class TemplateTests
{
    [Fact]
    public void DynamicUrlEncodingMatchesJavaScript()
        => Assert.Equal("a%2Fb!()*'%20%C3%A9", Templates.EncodeComponent("a/b!()*' é"));
    [Fact]
    public void NamedAndPositionalParametersHaveIndependentScopesAndWebEnvelope()
    {
        var template = JObject.Parse("{name:'appointment',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'HEADER',format:'TEXT',text:'Hello {{name}}'},{type:'BODY',text:'Appointment {{1}} at {{2}}.'},{type:'FOOTER',text:'Thank you'},{type:'BUTTONS',buttons:[{type:'URL',text:'View',url:'https://example.com/{{token}}'},{type:'QUICK_REPLY',text:'Confirm'}]}]}");
        var values = new Dictionary<string, string> { ["root.header.name"] = "Ana", ["root.body.1"] = "Monday", ["root.body.2"] = "12:00", ["root.button.0"] = "a/b", ["root.button.1"] = "confirm" };
        var content = Templates.Build(template, values);
        Assert.True(JToken.DeepEquals(JObject.Parse("{version:'1',type:'data',kind:'template',data:{name:'appointment',language:{code:'en_US'},components:[{type:'header',parameters:[{type:'text',text:'Ana',parameter_name:'name'}]},{type:'body',parameters:[{type:'text',text:'Monday'},{type:'text',text:'12:00'}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'a%2Fb',parameter_name:'token'}]},{type:'button',sub_type:'quick_reply',index:'1',parameters:[{type:'payload',payload:'confirm'}]}]}}"), content));
        var resolved = Templates.ResolvedValues(content);
        Assert.Equal("Hello Ana", Templates.Fill("Hello {{name}}", resolved, "root.header."));
        Assert.Equal("At Monday", Templates.Fill("At {{1}}", resolved, "root.body."));
    }
    [Fact]
    public void MediaHeaderAndStaticTemplatesMatchWebGraphPayload()
    {
        var template = JObject.Parse("{name:'media',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Hi!'}]}");
        Assert.NotEmpty(Templates.Validate(template, new Dictionary<string, string>()));
        var result = Templates.Build(template, new Dictionary<string, string> { ["root.media"] = "https://example.com/signed" });
        Assert.Equal("https://example.com/signed", (string?)result["data"]?["components"]?[0]?["parameters"]?[0]?["image"]?["link"]);
        template["components"] = new JArray(JObject.Parse("{type:'BODY',text:'Hello!'}"));
        Assert.Null(Templates.Build(template, new Dictionary<string, string>())["data"]?["components"]);
    }
    [Fact]
    public void RejectsUnapprovedUnknownMissingAndOverlongFilledText()
    {
        var template = JObject.Parse("{name:'test',status:'PENDING',components:[{type:'UNKNOWN'}]}");
        Assert.Equal(2, Templates.Validate(template, new Dictionary<string, string>()).Count);
        template["status"] = "APPROVED"; template["components"] = JArray.Parse("[{type:'HEADER',format:'TEXT',text:'Hi {{1}}'},{type:'BODY',text:'Hello {{name}}!'}]");
        Assert.Equal(2, Templates.Validate(template, new Dictionary<string, string>()).Count);
        Assert.NotEmpty(Templates.Validate(template, new Dictionary<string, string> { ["root.header.1"] = new string('x', 60), ["root.body.name"] = "Ana" }));
    }
    [Fact]
    public void AuthenticationSendsSameCodeInBodyAndUrlButton()
    {
        var template = JObject.Parse("{name:'otp',language:'en_US',status:'APPROVED',category:'AUTHENTICATION',components:[]}");
        var result = Templates.Build(template, new Dictionary<string, string> { ["otp"] = "123456" });
        Assert.Equal("123456", (string?)result["data"]?["components"]?[0]?["parameters"]?[0]?["text"]);
        Assert.Equal("123456", (string?)result["data"]?["components"]?[1]?["parameters"]?[0]?["text"]);
        Assert.NotEmpty(Templates.Validate(template, new Dictionary<string, string> { ["otp"] = "12 34" }));
    }
    [Fact]
    public void CarouselCardsKeepVariablesAndMediaScoped()
    {
        var template = JObject.Parse("{name:'cards',language:'en_US',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Hello {{1}}!'},{type:'CAROUSEL',cards:[{components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Product {{1}}!'}]},{components:[{type:'HEADER',format:'VIDEO'},{type:'BODY',text:'Product {{1}}!'}]}]}]}");
        var result = Templates.Build(template, new Dictionary<string, string> { ["root.body.1"] = "Ana", ["card.0.body.1"] = "One", ["card.1.body.1"] = "Two", ["card.0.media"] = "123", ["card.1.media"] = "456" });
        Assert.Equal("One", (string?)result["data"]?["components"]?[1]?["cards"]?[0]?["components"]?[1]?["parameters"]?[0]?["text"]);
        Assert.Equal("456", (string?)result["data"]?["components"]?[1]?["cards"]?[1]?["components"]?[0]?["parameters"]?[0]?["video"]?["id"]);
    }

    [Fact]
    public void CatalogInfersKindsAndDuplicatesTemplatesFaithfully()
    {
        Assert.Equal("authentication", Templates.InferKind(JObject.Parse("{name:'otp',language:'pt_BR',status:'APPROVED',category:'AUTHENTICATION',components:[{type:'BODY'}]}")));
        Assert.Equal("offer", Templates.InferKind(JObject.Parse("{name:'bf',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'LIMITED_TIME_OFFER',limited_time_offer:{text:'Off',has_expiration:true}},{type:'BODY',text:'Hi'}]}")));
        Assert.Equal("carousel", Templates.InferKind(JObject.Parse("{name:'c',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Hi'},{type:'CAROUSEL',cards:[{components:[{type:'HEADER',format:'IMAGE'}]}]}]}")));
        Assert.Equal("productCarousel", Templates.InferKind(JObject.Parse("{name:'pc',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Hi'},{type:'CAROUSEL',cards:[{components:[{type:'HEADER',format:'PRODUCT'}]}]}]}")));
        Assert.Equal("callPermission", Templates.InferKind(JObject.Parse("{name:'cp',language:'pt_BR',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Call?'},{type:'CALL_PERMISSION_REQUEST'}]}")));
        Assert.Equal("mpm", Templates.InferKind(JObject.Parse("{name:'mpm',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Items'},{type:'BUTTONS',buttons:[{type:'MPM',text:'View'}]}]}")));
        Assert.Equal("catalog", Templates.InferKind(JObject.Parse("{name:'cat',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Cat'},{type:'BUTTONS',buttons:[{type:'CATALOG',text:'View'}]}]}")));
        Assert.Equal("product", Templates.InferKind(JObject.Parse("{name:'spm',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'PRODUCT'},{type:'BODY',text:'Prod'}]}")));
        Assert.Equal("flow", Templates.InferKind(JObject.Parse("{name:'fl',language:'pt_BR',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Flow'},{type:'BUTTONS',buttons:[{type:'FLOW',text:'Open',flow_id:'123'}]}]}")));
        Assert.Equal("coupon", Templates.InferKind(JObject.Parse("{name:'cpn',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Code'},{type:'BUTTONS',buttons:[{type:'COPY_CODE',example:'SAVE10'}]}]}")));
        Assert.Equal("media", Templates.InferKind(JObject.Parse("{name:'med',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'VIDEO'},{type:'BODY',text:'Watch'}]}")));

        var source = JObject.Parse("{name:'order_status',language:'pt_BR',status:'APPROVED',category:'UTILITY',components:[{type:'HEADER',format:'TEXT',text:'Pedido {{1}}',example:{header_text:['#99']}},{type:'BODY',text:'Olá {{1}}, status: {{2}}.',example:{body_text:[['Maria','Enviado']]}},{type:'FOOTER',text:'Obrigado'},{type:'BUTTONS',buttons:[{type:'URL',text:'Rastrear',url:'https://example.com/{{1}}',example:['https://example.com/99']}]}]}");
        var dup = Templates.DuplicateTemplate(source);
        Assert.Equal("order_status_copy", dup.Name);
        Assert.Equal("UTILITY", dup.Category);
        Assert.Equal("#99", dup.Header.Examples["1"]);
        Assert.Equal("Maria", dup.Body.Examples["1"]);
        Assert.Equal("Enviado", dup.Body.Examples["2"]);
        Assert.Equal("https://example.com/99", dup.Buttons[0].UrlExample);
    }

    [Fact]
    public void PayloadBuilderMatchesWebExpectedGraphPayloads()
    {
        // 1. Named variable standard template
        var draft = Templates.NewDraft("standard");
        draft.Name = "order_update";
        draft.Language = "pt_BR";
        draft.Category = "UTILITY";
        draft.Header = new HeaderDraft { Format = "TEXT", Text = "Pedido {{order_id}}", Examples = new() { ["order_id"] = "1042" } };
        draft.Body = new TextDraft { Text = "Olá {{customer_name}}, seu pedido saiu.", Examples = new() { ["customer_name"] = "Maria" } };
        draft.Footer = "Zappion";
        draft.Buttons = [new ButtonDraft { Type = "QUICK_REPLY", Text = "Recebi" }];
        Assert.Empty(Templates.ValidateDraft(draft));

        var payload = Templates.BuildCreatePayload(draft, "org-1", "5511999999999");
        var expectedNamed = JObject.Parse(@"{
            organization_id: 'org-1',
            organization_address: '5511999999999',
            name: 'order_update',
            language: 'pt_BR',
            category: 'UTILITY',
            parameter_format: 'NAMED',
            components: [
                { type: 'HEADER', format: 'TEXT', text: 'Pedido {{order_id}}', example: { header_text_named_params: [{ param_name: 'order_id', example: '1042' }] } },
                { type: 'BODY', text: 'Olá {{customer_name}}, seu pedido saiu.', example: { body_text_named_params: [{ param_name: 'customer_name', example: 'Maria' }] } },
                { type: 'FOOTER', text: 'Zappion' },
                { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Recebi' }] }
            ]
        }");
        Assert.True(JToken.DeepEquals(expectedNamed, payload));

        // 2. Positional variable template with media header
        var mediaDraft = Templates.NewDraft("media");
        mediaDraft.Name = "promo_banner";
        mediaDraft.Header.Format = "IMAGE";
        mediaDraft.Header.SampleHandle = "4::aW1hZ2U=";
        mediaDraft.Body = new TextDraft { Text = "Olá {{1}}, aproveite {{2}}!", Examples = new() { ["1"] = "Maria", ["2"] = "20% OFF" } };
        Assert.Empty(Templates.ValidateDraft(mediaDraft));
        var mediaPayload = Templates.BuildCreatePayload(mediaDraft, "org-1", "addr-1");
        Assert.Null(mediaPayload["parameter_format"]);
        Assert.Equal("4::aW1hZ2U=", (string?)mediaPayload["components"]?[0]?["example"]?["header_handle"]?[0]);
        Assert.Equal("Maria", (string?)mediaPayload["components"]?[1]?["example"]?["body_text"]?[0]?[0]);
        Assert.Equal("20% OFF", (string?)mediaPayload["components"]?[1]?["example"]?["body_text"]?[0]?[1]);

        // 3. Authentication OTP (ONE_TAP)
        var auth = Templates.NewDraft("authentication");
        auth.Name = "login_otp";
        auth.CodeExpirationMinutes = "5";
        auth.AuthButton.OtpType = "ONE_TAP";
        auth.AuthButton.Text = "Copiar";
        auth.AuthButton.AutofillText = "Preencher";
        auth.AuthButton.SupportedApps = [new SupportedApp("com.zappion.app", "a1b2c3d4e5f")];
        Assert.Empty(Templates.ValidateDraft(auth));
        var authPayload = Templates.BuildCreatePayload(auth, "org-1", "addr-1");
        var expectedAuth = JArray.Parse(@"[
            { type: 'BODY', add_security_recommendation: true },
            { type: 'FOOTER', code_expiration_minutes: 5 },
            { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'ONE_TAP', text: 'Copiar', autofill_text: 'Preencher', supported_apps: [{ package_name: 'com.zappion.app', signature_hash: 'a1b2c3d4e5f' }] }] }
        ]");
        Assert.True(JToken.DeepEquals(expectedAuth, authPayload["components"]));

        // 4. Limited-time offer (LTO)
        var offer = Templates.NewDraft("offer");
        offer.Name = "black_friday";
        offer.Header.SampleHandle = "4::img";
        offer.OfferText = "Ends tonight!";
        offer.Body.Text = "Shop now with our coupon.";
        offer.Buttons[0].Example = "BF50";
        offer.Buttons[1].Text = "Shop";
        offer.Buttons[1].Url = "https://example.com/bf";
        Assert.Empty(Templates.ValidateDraft(offer));
        var offerComps = Templates.DraftComponents(offer);
        Assert.Contains(offerComps, c => (string?)c["type"] == "LIMITED_TIME_OFFER" && (string?)c["limited_time_offer"]?["text"] == "Ends tonight!");

        // 5. Carousel
        var carousel = Templates.NewDraft("carousel");
        carousel.Name = "summer_cards";
        carousel.Body.Text = "Check out our new collection.";
        carousel.Cards[0].SampleHandle = "4::card1";
        carousel.Cards[0].Body = "Item {{1}}";
        carousel.Cards[0].BodyExamples["1"] = "Shirt";
        carousel.Cards[0].Buttons[0].Text = "Buy";
        carousel.Cards[1].SampleHandle = "4::card2";
        carousel.Cards[1].Body = "Item {{1}}";
        carousel.Cards[1].BodyExamples["1"] = "Pants";
        carousel.Cards[1].Buttons[0].Text = "Buy";
        Assert.Empty(Templates.ValidateDraft(carousel));
        var carouselPayload = Templates.BuildCreatePayload(carousel, "org-1", "addr-1");
        Assert.Equal(2, (carouselPayload["components"]?[1]?["cards"] as JArray)?.Count);
    }

    [Fact]
    public void ValidationCatchesAllMetaRules()
    {
        var d = Templates.NewDraft("standard");
        d.Name = "Invalid-Name!";
        d.Body.Text = "{{1}} starts with variable";
        var issues = Templates.ValidateDraft(d);
        Assert.Contains(issues, i => i.Field == "name");
        Assert.Contains(issues, i => i.Field == "body");

        d.Name = "valid_name";
        d.Body.Text = "Hi {{1}} {{2}} end";
        Assert.Contains(Templates.ValidateDraft(d), i => i.Field == "body"); // adjacent + missing examples

        d.Body.Text = "Hi {{1}} and {{3}} end";
        d.Body.Examples["1"] = "a"; d.Body.Examples["3"] = "b";
        Assert.Contains(Templates.ValidateDraft(d), i => i.Field == "body"); // non-sequential

        d.Body.Text = "Hi {{1}} and {{name}} end";
        d.Body.Examples["name"] = "b";
        Assert.Contains(Templates.ValidateDraft(d), i => i.Field == "body"); // mixed positional and named

        d.Body.Text = "Hi {{name}} and {{name}} end";
        Assert.Contains(Templates.ValidateDraft(d), i => i.Field == "body"); // duplicate named

        // Interleaved quick reply and CTA buttons
        d.Body.Text = "Valid body text.";
        d.Buttons = [
            new ButtonDraft { Type = "QUICK_REPLY", Text = "Yes" },
            new ButtonDraft { Type = "URL", Text = "Site", Url = "https://example.com" },
            new ButtonDraft { Type = "QUICK_REPLY", Text = "No" }
        ];
        Assert.Contains(Templates.ValidateDraft(d), i => i.Field == "buttons");

        // Auth ONE_TAP requires 11-char signature hash
        var auth = Templates.NewDraft("authentication");
        auth.Name = "auth_test";
        auth.AuthButton.OtpType = "ONE_TAP";
        auth.AuthButton.SupportedApps = [new SupportedApp("com.example", "short")];
        Assert.Contains(Templates.ValidateDraft(auth), i => i.Field == "authButton");
    }

    [Fact]
    public void ValidateTemplateMediaEnforcesSizeAndMimePerFormat()
    {
        Assert.Null(Templates.ValidateTemplateMedia("banner.jpg", 1024, "image/jpeg", "IMAGE"));
        Assert.Null(Templates.ValidateTemplateMedia("banner.png", 1024, "image/png", "IMAGE"));
        Assert.Null(Templates.ValidateTemplateMedia("clip.mp4", 2048, "video/mp4", "VIDEO"));
        Assert.Null(Templates.ValidateTemplateMedia("spec.pdf", 4096, "application/pdf", "DOCUMENT"));

        Assert.NotNull(Templates.ValidateTemplateMedia("empty.jpg", 0, "image/jpeg", "IMAGE"));
        Assert.NotNull(Templates.ValidateTemplateMedia("huge.jpg", 5L * 1024 * 1024 + 1, "image/jpeg", "IMAGE"));
        Assert.NotNull(Templates.ValidateTemplateMedia("huge.mp4", 16L * 1024 * 1024 + 1, "video/mp4", "VIDEO"));
        Assert.NotNull(Templates.ValidateTemplateMedia("photo.webp", 1024, "image/webp", "IMAGE"));
        Assert.NotNull(Templates.ValidateTemplateMedia("clip.mov", 1024, "video/quicktime", "VIDEO"));
    }

    [Fact]
    public void DisplayFiltersQualityAndLanguagesMatchWeb()
    {
        var list = new[]
        {
            JObject.Parse("{name:'welcome',language:'pt_BR',status:'APPROVED',category:'MARKETING',quality_score:{score:'GREEN'},components:[{type:'BODY',text:'Bem-vindo'}]}"),
            JObject.Parse("{name:'otp_code',language:'en_US',status:'REJECTED',category:'AUTHENTICATION',quality_score:{score:'RED'},components:[{type:'BODY'}]}")
        };
        Assert.Single(Templates.FilterTemplates(list, new TemplateFilters(Status: "APPROVED")));
        Assert.Single(Templates.FilterTemplates(list, new TemplateFilters(Category: "AUTHENTICATION")));
        Assert.Single(Templates.FilterTemplates(list, new TemplateFilters(Kind: "authentication")));
        Assert.Single(Templates.FilterTemplates(list, new TemplateFilters(Language: "pt_BR")));
        Assert.Single(Templates.FilterTemplates(list, new TemplateFilters(Query: "bem-vindo")));
        Assert.Equal("emerald", Templates.TemplateQuality(list[0]).Tone);
        Assert.Equal("red", Templates.TemplateQuality(list[1]).Tone);
        Assert.Contains("pt_BR", Templates.LanguageLabel("pt_BR", "pt-BR"));
        Assert.NotNull(Templates.UnsupportedTemplateReason(list[1]));
        Assert.Null(Templates.UnsupportedTemplateReason(list[0]));
    }
}
