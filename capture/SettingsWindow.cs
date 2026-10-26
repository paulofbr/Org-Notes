using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;

namespace OrgNotes.Capture;

public class SettingsWindow : Window
{
    public SettingsWindow(Config config)
    {
        Title = L.Tr("Definições · Org Notes Capture");
        Width = 480;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var server = new TextBox { Text = config.Server };
        var token = new TextBox { Text = config.Token, PasswordChar = '•', PlaceholderText = L.Tr("Só necessário com login Google") };
        var hotkey = new TextBox { Text = config.Hotkey, IsVisible = OperatingSystem.IsWindows() };
        var autostart = new CheckBox
        {
            Content = L.Tr("Arrancar com o Windows"),
            IsVisible = OperatingSystem.IsWindows(),
            IsChecked = OperatingSystem.IsWindows() && WindowsStartup.IsEnabled,
        };
        var reminders = new CheckBox { Content = L.Tr("Mostrar lembretes da agenda neste computador"), IsChecked = config.Reminders };
        var status = new TextBlock { Opacity = 0.7, TextWrapping = Avalonia.Media.TextWrapping.Wrap };
        var test = new Button { Content = L.Tr("Testar ligação") };
        var save = new Button { Content = L.Tr("Guardar"), Classes = { "accent" } };

        Config Edited() => new() { Server = server.Text?.Trim() ?? "", Token = token.Text?.Trim() ?? "", Hotkey = hotkey.Text?.Trim() ?? config.Hotkey };
        test.Click += async (_, _) =>
        {
            status.Text = L.Tr("A testar…");
            try
            {
                var list = await new Api(Edited()).Templates();
                status.Text = L.Tr("Ligação OK · {0} templates.", list.Count);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UriFormatException or InvalidOperationException)
            {
                status.Text = e.Message;
            }
        };
        save.Click += (_, _) =>
        {
            var edited = Edited();
            (config.Server, config.Token, config.Hotkey, config.Reminders) = (edited.Server, edited.Token, edited.Hotkey, reminders.IsChecked == true);
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
                new TextBlock { Text = L.Tr("Servidor") }, server,
                new TextBlock { Text = L.Tr("Token (no site: sino → Conta e notificações)") }, token,
                new TextBlock { Text = L.Tr("Atalho global, ex. Win+Alt+C (reinicia a app para aplicar)"), IsVisible = OperatingSystem.IsWindows() }, hotkey,
                autostart,
                reminders,
                new TextBlock
                {
                    Text = L.Tr("No Linux o atalho é definido no ambiente de trabalho: liga uma tecla a «OrgNotes.Capture --show»."),
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
