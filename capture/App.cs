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
    private TrayIcon? _tray;
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
        if (!Config.Exists) ShowSettings();
        else if (showOnStart) ShowCapture();
        base.OnFrameworkInitializationCompleted();
    }

    private void RenderTray()
    {
        var menu = new NativeMenu();
        menu.Add(Item(L.Tr("Capturar"), ShowCapture));
        menu.Add(Item(L.Tr("Definições"), ShowSettings));
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
        if (_capture == null)
        {
            _capture = new CaptureWindow(new Api(_config)) { Icon = _icon };
            _capture.LanguageChanged += ChangeLanguage;
        }
        _capture.ShowForCapture();
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
