// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Supabase.Realtime.Socket;

namespace Zappion.Windows.Core;

// Supabase.Realtime 7.0.2 first decodes records as SocketResponsePayload, whose Status is a string.
// Message status is JSON. Ignore it only in that intermediate envelope; Model<MessageRow>() then
// decodes the original JSON with the Postgrest attributes and preserves the complete receipt object.
internal sealed class RealtimeContractResolver(IContractResolver inner) : IContractResolver
{
    public JsonContract ResolveContract(Type type)
    {
        var contract = inner.ResolveContract(type);
        if (contract is JsonObjectContract obj)
            foreach (var property in obj.Properties)
                if (property.DeclaringType == typeof(SocketResponsePayload) && property.PropertyName == "status")
                    property.Converter = new EnvelopeStatusConverter();
        return contract;
    }

    private sealed class EnvelopeStatusConverter : JsonConverter<string>
    {
        public override string? ReadJson(JsonReader reader, Type objectType, string? existingValue,
            bool hasExistingValue, JsonSerializer serializer)
        {
            var value = JToken.Load(reader);
            return value.Type == JTokenType.String ? value.Value<string>() : null;
        }

        public override void WriteJson(JsonWriter writer, string? value, JsonSerializer serializer) => writer.WriteValue(value);
    }
}
