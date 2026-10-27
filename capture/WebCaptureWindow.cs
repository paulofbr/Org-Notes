using Avalonia.Controls;
using Avalonia.Platform;

namespace OrgNotes.Capture;

/// <summary>
/// The site's own Capture (or "Do texto (IA)") dialog in a web view, so the app always has the site's features and look.
/// It signs in with a one-time code traded for the app's token; the page sends "closed" when its dialog closes, which
/// hides the window, and the page stays loaded so the next capture opens at once (and its saves finish).
/// </summary>
public class WebCaptureWindow : Window
{
    private readonly Config _config;
    private readonly NativeWebView _web = new();
    private string _kind = "capture";
    // The server whose page is loaded and ready for window.openApp (null while loading or signing in).
    private string? _readyFor;
    private bool _discarded;

    public event Action<string>? LanguageChanged;

    public WebCaptureWindow(Config config)
    {
        _config = config;
        Title = "Org Notes";
        (Width, Height) = (600, 700);
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Content = _web;

        // The site's cookies and cache in the user's local folder (not next to the program, which may not be writable).
        _web.EnvironmentRequested += (_, e) =>
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "orgnotes", "webview");
            if (e is WindowsWebView2EnvironmentRequestedEventArgs windows) windows.UserDataFolder = dir;
            else if (e is GtkWebViewEnvironmentRequestedEventArgs gtk) (gtk.BaseDataDirectory, gtk.BaseCacheDirectory) = (dir, Path.Combine(dir, "cache"));
        };
        _web.NavigationStarted += async (_, e) =>
        {
            if (e.Request is not { } to || to.Scheme is not ("http" or "https")) return;
            if (!SameSite(to))
            {
                // Links to other sites open in the browser.
                e.Cancel = true;
                if (Launcher is { } launcher) await launcher.LaunchUriAsync(to);
            }
            else if (to.AbsolutePath == "/app/closed")
            {
                // The page's fallback when the message bridge is missing.
                e.Cancel = true;
                Hide();
            }
            else if (to.AbsolutePath == "/login")
            {
                // The session ended: sign in again with a new code.
                e.Cancel = true;
                await SignIn();
            }
        };
        _web.WebMessageReceived += (_, e) =>
        {
            if (e.Body == "closed") Hide();
        };
        _web.NavigationCompleted += (_, e) => _readyFor = e.IsSuccess && e.Request is { } at && SameSite(at) && at.AbsolutePath == "/" ? _config.Server : null;
        Closing += (_, e) =>
        {
            if (_discarded) return;
            e.Cancel = true;
            Hide();
        };
    }

    // Read each time, as the settings may change the server.
    private Uri Server => new(_config.Server.TrimEnd('/') + "/");

    private bool SameSite(Uri u) => u.Scheme == Server.Scheme && u.Host == Server.Host && u.Port == Server.Port;

    /// <summary>Shows the capture ("capture") or the AI extraction ("extract") dialog, fresh.</summary>
    public async void Open(string kind)
    {
        Show();
        Activate();
        _web.Focus();
        _kind = kind;
        if (_readyFor == _config.Server)
        {
            await _web.InvokeScript($"window.openApp && window.openApp('{kind}')");
            return;
        }
        await SignIn();
        try
        {
            // The tray speaks the user's language, as the site does.
            var me = await new Api(_config).Me();
            if (L.Langs.Contains(me.Lang) && me.Lang != L.Lang) LanguageChanged?.Invoke(me.Lang!);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { }
    }

    private async Task SignIn()
    {
        _readyFor = null;
        try
        {
            var code = await new Api(_config).AppCode();
            _web.Navigate(new Uri(Server, $"login/app?code={code}&returnUrl={Uri.EscapeDataString($"/?app={_kind}")}"));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _web.NavigateToString($"<p style=\"font: 15px system-ui; padding: 1rem\">{System.Net.WebUtility.HtmlEncode(e.Message)}</p>", Server);
        }
    }

    /// <summary>Closes the window for good (on quitting, or when the language changes).</summary>
    public void Discard()
    {
        _discarded = true;
        Close();
    }
}
