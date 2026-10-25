using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OrgNotes.Server;

/// <param name="SummarySent">Day the daily summary last went out, so a restart does not send it again.</param>
public record UserSettings(string NtfyTopic, bool Notify, string? ApiToken = null, DateOnly? SummarySent = null, string? PasswordHash = null, string? Lang = null);

/// <summary>
/// Per-user file stores: each user gets `users/&lt;email&gt;/` under the root. Files left in the root by the
/// old single-user mode move to the first user's folder.
/// </summary>
public class Users(string root, string seedDir)
{
    private readonly ConcurrentDictionary<string, OrgStore> _stores = new();
    private readonly Lock _settingsLock = new();

    public static string KeyOfEmail(string email) => Regex.Replace(email.ToLowerInvariant(), @"[^a-z0-9._@+-]", "_");

    public string Key(ClaimsPrincipal user) => KeyOfEmail(user.FindFirstValue(ClaimTypes.Email) ?? "");

    /// <summary>The folder with a user's notes (and their `.images`).</summary>
    public string Root(string key) => Dir(key);

    /// <summary>Uploaded file icons, referenced from a file's `#+ICON:` line.</summary>
    public string IconsDir(string key) => Path.Combine(Dir(key), ".icons");

    public bool Exists(string key) => Directory.Exists(Dir(key));

    public bool HasPassword(string key) => Exists(key) && Settings(key).PasswordHash != null;

    public void SetPassword(string key, string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, PasswordIterations, HashAlgorithmName.SHA256, 32);
        lock (_settingsLock) Save(key, Settings(key) with { PasswordHash = $"{PasswordIterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}" });
    }

    public bool CheckPassword(string key, string password)
    {
        if (!Exists(key) || Settings(key).PasswordHash?.Split('.') is not [var iterations, var salt, var hash]) return false;
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(salt), int.Parse(iterations), HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(actual, Convert.FromBase64String(hash));
    }

    private const int PasswordIterations = 600_000;

    /// <summary>Personal token for non-browser clients (the capture app), created on first use.</summary>
    public string Token(string key) => Settings(key).ApiToken ?? NewToken(key);

    public string NewToken(string key)
    {
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        lock (_settingsLock) Save(key, Settings(key) with { ApiToken = token });
        return token;
    }

    public string? KeyForToken(string token) =>
        All().FirstOrDefault(k => Settings(k).ApiToken is { } t &&
            CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(t), System.Text.Encoding.UTF8.GetBytes(token)));

    public IEnumerable<string> All()
    {
        var dir = Path.Combine(root, "users");
        return Directory.Exists(dir) ? Directory.GetDirectories(dir).Select(d => Path.GetFileName(d)) : [];
    }

    public OrgStore For(ClaimsPrincipal user) => Store(Key(user));

    public OrgStore Store(string key) => _stores.GetOrAdd(key, k =>
    {
        lock (_settingsLock) AdoptRootFiles(k);
        var store = new OrgStore(Dir(k));
        store.SeedIfEmpty(seedDir);
        return store;
    });

    /// <summary>Settings for a user, creating them with a fresh secret ntfy topic on first use.</summary>
    public UserSettings Settings(string key)
    {
        lock (_settingsLock)
        {
            AdoptRootFiles(key);
            var file = Path.Combine(Dir(key), ".settings.json");
            if (File.Exists(file) && JsonSerializer.Deserialize<UserSettings>(File.ReadAllText(file)) is { } s) return s;
            var created = new UserSettings("orgnotes-" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)), false);
            Save(key, created);
            return created;
        }
    }

    public void Save(string key, UserSettings settings)
    {
        lock (_settingsLock)
        {
            Directory.CreateDirectory(Dir(key));
            File.WriteAllText(Path.Combine(Dir(key), ".settings.json"), JsonSerializer.Serialize(settings));
        }
    }

    private string Dir(string key) => Path.Combine(root, "users", key);

    /// <summary>Moves the single-user mode's files (notes and settings) from the root into the first user's folder.</summary>
    private void AdoptRootFiles(string key)
    {
        if (Exists(key) || All().Any() || !Directory.Exists(root)) return;
        var entries = Directory.EnumerateFileSystemEntries(root).Where(e => Path.GetFileName(e) != "users").ToList();
        if (entries.Count == 0) return;
        Directory.CreateDirectory(Dir(key));
        foreach (var e in entries)
        {
            var target = Path.Combine(Dir(key), Path.GetFileName(e));
            if (Directory.Exists(e)) Directory.Move(e, target);
            else File.Move(e, target);
        }
    }
}
