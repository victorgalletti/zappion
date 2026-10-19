// SPDX-License-Identifier: AGPL-3.0-only
using Newtonsoft.Json;
using Supabase.Gotrue;
using Supabase.Gotrue.Interfaces;

namespace Zappion.Windows.Core;

public sealed class FileSessionPersistence : IGotrueSessionPersistence<Session>
{
    private readonly string path;
    private readonly object gate = new();

    public FileSessionPersistence(string? path = null)
    {
        this.path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Zappion", "session.json");
    }

    public void SaveSession(Session session)
    {
        lock (gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonConvert.SerializeObject(session));
            File.Move(temporary, path, true);
        }
    }

    public void DestroySession()
    {
        lock (gate) File.Delete(path);
    }

    public Session? LoadSession()
    {
        lock (gate)
        {
            if (!File.Exists(path)) return null;
            try { return JsonConvert.DeserializeObject<Session>(File.ReadAllText(path)); }
            catch (JsonException) { return null; }
        }
    }
}
