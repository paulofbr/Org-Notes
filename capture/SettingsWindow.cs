using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;

namespace OrgNotes.Capture;

public class SettingsWindow : Window
{
    public SettingsWindow(Config config)
    {
        Title = "Definições · Org Notes Capture";
        Width = 480;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var server = new TextBox { Text = config.Server };
        var token = new TextBox { Text = config.Token, PasswordChar = '•', PlaceholderText = "Só necessário com login Google" };
        var hotkey = new TextBox { Text = config.Hotkey, IsVisible = OperatingSystem.IsWindows() };
        var autostart = new CheckBox
        {
            Content = "Arrancar com o Windows",
            IsVisible = OperatingSystem.IsWindows(),
            IsChecked = OperatingSystem.IsWindows() && WindowsStartup.IsEnabled,
        };
        var status = new TextBlock { Opacity = 0.7, TextWrapping = Avalonia.Media.TextWrapping.Wrap };
        var test = new Button { Content = "Testar ligação" };
        var save = new Button { Content = "Guardar", Classes = { "accent" } };

        Config Edited() => new() { Server = server.Text?.Trim() ?? "", Token = token.Text?.Trim() ?? "", Hotkey = hotkey.Text?.Trim() ?? config.Hotkey };
        test.Click += async (_, _) =>
        {
            status.Text = "A testar…";
            try
            {
                var list = await new Api(Edited()).Templates();
                status.Text = $"Ligação OK · {list.Count} templates.";
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UriFormatException or InvalidOperationException)
            {
                status.Text = e.Message;
            }
        };
        save.Click += (_, _) =>
        {
            var edited = Edited();
            (config.Server, config.Token, config.Hotkey) = (edited.Server, edited.Token, edited.Hotkey);
            config.Save();
            if (OperatingSystem.IsWindows()) WindowsStartup.Set(autostart.IsChecked == true);
            Close();
        };

        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = "Servidor" }, server,
                new TextBlock { Text = "Token (no site: sino → Conta e notificações)" }, token,
                new TextBlock { Text = "Atalho global, ex. Win+Alt+C (reinicia a app para aplicar)", IsVisible = OperatingSystem.IsWindows() }, hotkey,
                autostart,
                new TextBlock
                {
                    Text = "No Linux o atalho é definido no ambiente de trabalho: liga uma tecla a «OrgNotes.Capture --show».",
                    IsVisible = !OperatingSystem.IsWindows(),
                    Opacity = 0.7,
                    TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                },
                status,
                new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { test, save } },
            },
        };
    }
}
