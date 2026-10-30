using System.Diagnostics;
using System.IO.Pipes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;

namespace OrgNotes.Capture;

public class App(bool showOnStart) : Application
{
    private readonly Config _config = Config.Load();
    private CaptureWindow? _capture;
    private WebCaptureWindow? _web;
    // Set when the web view fails on this machine: until the app restarts, the capture is the app's own window.
    private bool _webFailed;
    private TrayIcon? _tray;
    private Updater? _updater;
    private ReminderWindow? _reminders;
    private bool _hotkey;
    private WindowIcon? _icon;

    public override void Initialize()
    {
        Styles.Add(new FluentTheme());
        RequestedThemeVariant = ThemeVariant.Default;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        L.Lang = L.Initial(_config.Lang);
        _icon = new WindowIcon(new Bitmap(AssetLoader.Open(new Uri("avares://OrgNotes.Capture/Assets/icon.png"))));
        _tray = new TrayIcon { Icon = _icon };
        _tray.Clicked += (_, _) => ShowCapture();
        TrayIcon.SetIcons(this, [_tray]);
        _hotkey = !OperatingSystem.IsWindows() || WindowsHotkey.Register(_config.Hotkey, () => Dispatcher.UIThread.Post(ShowCapture));
        RenderTray();

        _ = ListenForShow();
        _ = new Reminders(_config, r => Dispatcher.UIThread.Post(() =>
            (_reminders ??= new ReminderWindow { Icon = _icon, OnView = ShowView }).Add(r))).Run();
        _updater = new Updater(_config, () => _capture?.IsVisible != true && _web?.IsVisible != true, () => Dispatcher.UIThread.Post(() => (ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown()));
        _ = _updater.Run();
        Updater.AnnounceUpdate();
        // The installer may already have written the server's address: the token still has to be pasted in.
        if (!Config.Exists || _config.Token == "") ShowSettings();
        else if (showOnStart) ShowCapture();
        base.OnFrameworkInitializationCompleted();
    }

    private void RenderTray()
    {
        var menu = new NativeMenu();
        menu.Add(Item(L.Tr("Capturar"), ShowCapture));
        menu.Add(Item(L.Tr("Criar a partir de texto (IA)"), () =>
        {
            if (_config.WebCapture && !_webFailed) Web().Open("extract");
            else new ExtractWindow(new Api(_config)) { Icon = _icon }.Show();
        }));
        menu.Add(Item(L.Tr("Definições"), ShowSettings));
        menu.Add(Item(L.Tr("Abrir registo de erros"), () =>
        {
            if (!File.Exists(Log.FilePath)) Log.Write("(registo aberto, sem erros)");
            Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true })?.Dispose();
        }));
        menu.Add(new NativeMenuItemSeparator());
        menu.Add(new NativeMenuItem(Updater.Version is { } v ? L.Tr("Versão {0}", "v" + v) : L.Tr("Versão de desenvolvimento")) { IsEnabled = false });
        if (Updater.Supported)
            menu.Add(Item(L.Tr("Procurar atualizações"), async () =>
            {
                if (await _updater!.Check(manual: true) is { Length: > 0 } result) Reminders.Show("Org Notes", result);
            }));
        menu.Add(new NativeMenuItemSeparator());
        menu.Add(Item(L.Tr("Sair"), () => (ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown()));
        _tray!.Menu = menu;
        _tray.ToolTipText = !OperatingSystem.IsWindows() ? L.Tr("Org Notes · Capturar")
            : _hotkey ? L.Tr("Org Notes · Capturar ({0})", _config.Hotkey)
            : L.Tr("Org Notes · atalho {0} indisponível (muda nas Definições)", _config.Hotkey);
    }

    private static NativeMenuItem Item(string header, Action run)
    {
        var item = new NativeMenuItem(header);
        item.Click += (_, _) => run();
        return item;
    }

    private void ShowCapture()
    {
        if (_config.WebCapture && !_webFailed)
        {
            Web().Open("capture");
            return;
        }
        if (_capture == null)
        {
            _capture = new CaptureWindow(new Api(_config)) { Icon = _icon };
            _capture.LanguageChanged += ChangeLanguage;
        }
        _capture.ShowForCapture();
    }

    /// <summary>What a reminder is about, listed (each entry read only): in the site's window, or in the browser when that is not in use.</summary>
    private void ShowView(string view)
    {
        if (_config.WebCapture && !_webFailed) Web().Open("view:" + view);
        else Process.Start(new ProcessStartInfo(Reminders.ViewUrl(_config, view)) { UseShellExecute = true })?.Dispose();
    }

    private WebCaptureWindow Web()
    {
        if (_web == null)
        {
            _web = new WebCaptureWindow(_config) { Icon = _icon };
            // The page follows the language by itself; the tray (and the native window) are rebuilt in it.
            _web.LanguageChanged += lang =>
            {
                _config.Lang = L.Lang = lang;
                _config.Save();
                RenderTray();
                _capture?.Discard();
                _capture = null;
            };
            _web.Failed += () =>
            {
                _webFailed = true;
                Reminders.Show("Org Notes", L.Tr("A captura do site não abriu neste computador: abre a janela da app. Detalhes em {0}", Log.FilePath));
                ShowCapture();
            };
        }
        return _web;
    }

    /// <summary>Follows the user's language from the server: remembers it and rebuilds the texts.</summary>
    private void ChangeLanguage(string lang)
    {
        _config.Lang = L.Lang = lang;
        _config.Save();
        RenderTray();
        _capture?.Discard();
        _capture = null;
        ShowCapture();
    }

    private void ShowSettings() => new SettingsWindow(_config) { Icon = _icon }.Show();

    /// <summary>Each connection from a second instance means "show the capture window".</summary>
    private async Task ListenForShow()
    {
        while (true)
        {
            try
            {
                await using var server = new NamedPipeServerStream(Program.PipeName, PipeDirection.In, 1);
                await server.WaitForConnectionAsync();
                Dispatcher.UIThread.Post(ShowCapture);
            }
            catch (IOException)
            {
                await Task.Delay(500);
            }
        }
    }
}
