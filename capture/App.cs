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
    private WindowIcon? _icon;

    public override void Initialize()
    {
        Styles.Add(new FluentTheme());
        RequestedThemeVariant = ThemeVariant.Default;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        _icon = new WindowIcon(new Bitmap(AssetLoader.Open(new Uri("avares://OrgNotes.Capture/Assets/icon.png"))));
        var menu = new NativeMenu();
        menu.Add(Item("Capturar", ShowCapture));
        menu.Add(Item("Definições", ShowSettings));
        menu.Add(new NativeMenuItemSeparator());
        menu.Add(Item("Sair", () => (ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown()));
        var tray = new TrayIcon { Icon = _icon, ToolTipText = "Org Notes · Capturar", Menu = menu };
        tray.Clicked += (_, _) => ShowCapture();
        TrayIcon.SetIcons(this, [tray]);

        _ = ListenForShow();
        if (OperatingSystem.IsWindows())
            tray.ToolTipText = WindowsHotkey.Register(_config.Hotkey, () => Dispatcher.UIThread.Post(ShowCapture))
                ? $"Org Notes · Capturar ({_config.Hotkey})"
                : $"Org Notes · atalho {_config.Hotkey} indisponível (muda nas Definições)";
        if (!Config.Exists) ShowSettings();
        else if (showOnStart) ShowCapture();
        base.OnFrameworkInitializationCompleted();
    }

    private static NativeMenuItem Item(string header, Action run)
    {
        var item = new NativeMenuItem(header);
        item.Click += (_, _) => run();
        return item;
    }

    private void ShowCapture()
    {
        _capture ??= new CaptureWindow(new Api(_config)) { Icon = _icon };
        _capture.ShowForCapture();
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
