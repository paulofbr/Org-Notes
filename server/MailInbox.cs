using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using Microsoft.AspNetCore.DataProtection;
using MimeKit;

namespace OrgNotes.Server;

/// <summary>A user's mailbox to read: one IMAP folder, read-only, from the moment it was set up.</summary>
public record MailAccount(
    string Host, int Port, string User, string ProtectedPassword, string Folder, bool Enabled,
    uint? UidValidity = null, uint? LastUid = null, DateTime? LastCheck = null, string? LastError = null);

/// <summary>An email whose items the AI proposed, waiting for the user to integrate or discard them.</summary>
public record InboxEntry(string Id, string From, string Subject, DateTime Date, List<ProposedItem> Items);

/// <summary>
/// Reads each user's mail folder every few minutes, has the AI propose items for every new email and keeps them in the
/// user's inbox (<c>.inbox.json</c>) until reviewed on the site. It never changes the mailbox.
/// </summary>
public partial class MailInbox(Users users, Extraction extraction, AiAssistant ai, IDataProtectionProvider protection, ILogger<MailInbox> log) : BackgroundService
{
    private const int PerCheck = 10;
    private readonly IDataProtector _protector = protection.CreateProtector("OrgNotes.Mail");
    private readonly Lock _lock = new();
    private readonly SemaphoreSlim _checking = new(1, 1);

    public string Protect(string password) => _protector.Protect(password);

    public string Password(MailAccount account) => _protector.Unprotect(account.ProtectedPassword);

    private string InboxPath(string key) => Path.Combine(users.Root(key), ".inbox.json");

    public List<InboxEntry> Inbox(string key)
    {
        lock (_lock)
        {
            try { return File.Exists(InboxPath(key)) ? JsonSerializer.Deserialize<List<InboxEntry>>(File.ReadAllText(InboxPath(key))) ?? [] : []; }
            catch (JsonException) { return []; }
        }
    }

    private void Change(string key, Action<List<InboxEntry>> change)
    {
        lock (_lock)
        {
            var entries = Inbox(key);
            change(entries);
            File.WriteAllText(InboxPath(key), JsonSerializer.Serialize(entries));
        }
    }

    public bool Remove(string key, string id)
    {
        var removed = false;
        Change(key, e => removed = e.RemoveAll(x => x.Id == id) > 0);
        return removed;
    }

    /// <summary>Connects with the given password; returns the folder's UIDVALIDITY and next UID, or throws with the reason.</summary>
    public async Task<(uint Validity, uint Next)> Test(MailAccount account, string password, CancellationToken ct)
    {
        using var client = await Connect(account, password, ct);
        var folder = await client.GetFolderAsync(account.Folder, ct);
        await folder.OpenAsync(FolderAccess.ReadOnly, ct);
        return (folder.UidValidity, folder.UidNext?.Id ?? 1);
    }

    private static async Task<ImapClient> Connect(MailAccount account, string password, CancellationToken ct)
    {
        var client = new ImapClient { Timeout = 30_000 };
        await client.ConnectAsync(account.Host, account.Port, MailKit.Security.SecureSocketOptions.Auto, ct);
        await client.AuthenticateAsync(account.User, password, ct);
        return client;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            foreach (var key in users.All())
                if (users.Settings(key).Mail is { Enabled: true }) await Check(key, stop);
        } while (await timer.WaitForNextTickAsync(stop));
    }

    /// <summary>Reads the user's new emails into their inbox; the outcome is kept in the account's LastCheck/LastError.</summary>
    public async Task Check(string key, CancellationToken ct)
    {
        if (users.Settings(key).Mail is not { } account || !ai.Enabled) return;
        await _checking.WaitAsync(ct);
        string? error = null;
        try
        {
            using var client = await Connect(account, Password(account), ct);
            var folder = await client.GetFolderAsync(account.Folder, ct);
            await folder.OpenAsync(FolderAccess.ReadOnly, ct);
            // A recreated folder renumbers its messages: start again from now rather than re-reading it all.
            if (account.UidValidity != folder.UidValidity || account.LastUid is not { } last)
            {
                Save(key, a => a with { UidValidity = folder.UidValidity, LastUid = (folder.UidNext?.Id ?? 1) - 1 });
                return;
            }
            var uids = (await folder.SearchAsync(SearchQuery.Uids(new UniqueIdRange(new UniqueId(last + 1), UniqueId.MaxValue)), ct))
                .Where(u => u.Id > last).OrderBy(u => u.Id).Take(PerCheck).ToList();
            var store = users.Store(key);
            var lang = users.Settings(key).Lang is { } l && Strings.IsLang(l) ? l : "pt";
            // When each email reached the mailbox, for emails without a Date header.
            var arrived = uids.Count == 0 ? [] : (await folder.FetchAsync(uids, MessageSummaryItems.InternalDate, ct))
                .Where(s => s.UniqueId.IsValid && s.InternalDate != null).ToDictionary(s => s.UniqueId.Id, s => s.InternalDate!.Value);
            foreach (var uid in uids)
            {
                var message = await folder.GetMessageAsync(uid, ct);
                var from = message.From.Mailboxes.FirstOrDefault() is { } f ? (f.Name is { Length: > 0 } n ? $"{n} <{f.Address}>" : f.Address) : "";
                var date = message.Date > DateTimeOffset.MinValue ? message.Date.LocalDateTime
                    : arrived.TryGetValue(uid.Id, out var a) ? a.LocalDateTime : DateTime.Now;
                var text = $"From: {from}\nSubject: {message.Subject}\nDate: {date:yyyy-MM-dd HH:mm}\n\n{BodyText(message)}";
                // Relative dates in an email ("next Tuesday") count from when it was sent.
                var items = await extraction.Run(store, text, date, lang, ct);
                if (items.Count > 0) Change(key, e => e.Add(new InboxEntry($"{folder.UidValidity}-{uid.Id}", from, message.Subject ?? "", date, items)));
                Save(key, a => a with { LastUid = uid.Id });
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Mail check failed for {User}", key);
            error = e.Message;
        }
        finally
        {
            Save(key, a => a with { LastCheck = DateTime.Now, LastError = error });
            _checking.Release();
        }
    }

    private void Save(string key, Func<MailAccount, MailAccount> change)
    {
        if (users.Settings(key).Mail is { } account) users.Save(key, users.Settings(key) with { Mail = change(account) });
    }

    [GeneratedRegex(@"<(script|style)[^>]*>.*?</\1>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex HiddenRe();
    [GeneratedRegex(@"<br\s*/?>|</(p|div|li|tr|h\d)>", RegexOptions.IgnoreCase)] private static partial Regex BreakRe();
    [GeneratedRegex("<[^>]+>")] private static partial Regex TagRe();
    [GeneratedRegex(@"\n\s*\n\s*\n+")] private static partial Regex BlankLinesRe();

    /// <summary>The message's text, from its HTML when it has no plain-text part.</summary>
    public static string BodyText(MimeMessage message)
    {
        if (message.TextBody is { Length: > 0 } text) return text;
        var html = message.HtmlBody ?? "";
        html = BreakRe().Replace(HiddenRe().Replace(html, ""), "\n");
        return BlankLinesRe().Replace(WebUtility.HtmlDecode(TagRe().Replace(html, "")), "\n\n").Trim();
    }
}
