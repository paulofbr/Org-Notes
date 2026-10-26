using System.Text.Json;

namespace OrgNotes.Server;

/// <summary>
/// Who may sign in: the emails in Auth:AllowedEmails (fixed, from the configuration) plus the ones the administrator
/// adds on the site, kept in <c>allowed.json</c> in the notes folder. The administrators are Auth:Admins, or else the
/// first configured email.
/// </summary>
public class Access(string root, string[] configured, string[] admins)
{
    public const string FileName = "allowed.json";
    private readonly Lock _lock = new();
    private string FilePath => Path.Combine(root, FileName);

    public IReadOnlyList<string> Configured => configured;

    public List<string> Added
    {
        get
        {
            lock (_lock)
            {
                try { return File.Exists(FilePath) ? JsonSerializer.Deserialize<List<string>>(File.ReadAllText(FilePath)) ?? [] : []; }
                catch (JsonException) { return []; }
            }
        }
    }

    private static bool Same(string a, string b) => Users.KeyOfEmail(a) == Users.KeyOfEmail(b);

    public bool IsAllowed(string email) => email != "" && (configured.Any(a => Same(a, email)) || Added.Any(a => Same(a, email)));

    public bool IsAdmin(string email) => email != "" && (admins.Length > 0 ? admins : configured.Take(1)).Any(a => Same(a, email));

    /// <summary>Allows a new email; false when it is not an email or is already allowed.</summary>
    public bool Add(string email)
    {
        email = email.Trim();
        if (!System.Net.Mail.MailAddress.TryCreate(email, out var parsed) || parsed.Address != email || IsAllowed(email)) return false;
        lock (_lock) Save([.. Added, email]);
        return true;
    }

    /// <summary>Removes an email added on the site; the configured ones can only change in the configuration.</summary>
    public bool Remove(string email)
    {
        lock (_lock)
        {
            var added = Added;
            if (added.RemoveAll(a => Same(a, email)) == 0) return false;
            Save(added);
            return true;
        }
    }

    private void Save(List<string> emails)
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(emails));
    }
}
