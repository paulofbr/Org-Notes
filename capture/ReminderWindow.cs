using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace OrgNotes.Capture;

/// <summary>
/// The agenda reminders in a small window that stays above every other one, in the corner of the screen, until OK or
/// "Adiar 5 min" (which brings them back five minutes later). Reminders that arrive meanwhile join the list.
/// </summary>
public partial class ReminderWindow : Window
{
    private readonly StackPanel _list = new() { Spacing = 10 };
    private readonly List<Reminder> _items = [];
    /// <summary>Shows what a reminder is about ("Ver"), given its <see cref="Reminder.View"/>, in the app's window.</summary>
    public required Action<string> OnView { get; init; }
    /// <summary>The reminder's list on the site, in the browser ("Org Notes").</summary>
    public required Action<string> OnSite { get; init; }

    public ReminderWindow()
    {
        Title = L.Tr("Lembretes · Org Notes");
        Width = 380;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        Topmost = true;
        // Visible without taking the keyboard from whatever the user is typing in.
        ShowActivated = false;

        var snooze = new Button { Content = L.Tr("Adiar 5 min") };
        snooze.Click += (_, _) => Snooze(TimeSpan.FromMinutes(5));
        var ok = new Button { Content = "OK", Classes = { "accent" } };
        ok.Click += (_, _) => Dismiss();
        Content = new Border
        {
            BorderBrush = new SolidColorBrush(Color.Parse("#6d4aff")),
            BorderThickness = new Thickness(0, 4, 0, 0),
            Padding = new Thickness(16),
            Child = new StackPanel
            {
                Spacing = 12,
                Children =
                {
                    _list,
                    new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { snooze, ok } },
                },
            },
        };
        // Closing it is the same as OK; it is reused for the next reminders.
        Closing += (_, e) =>
        {
            e.Cancel = true;
            Dismiss();
        };
        SizeChanged += (_, _) => PlaceInCorner();
    }

    public void Add(Reminder r)
    {
        _items.Add(r);
        var view = new Button { Content = L.Tr("Ver"), HorizontalAlignment = HorizontalAlignment.Stretch };
        view.Click += (_, _) => OnView(r.View!);
        var site = new Button { Content = "Org Notes", HorizontalAlignment = HorizontalAlignment.Stretch };
        site.Click += (_, _) => OnSite(r.View!);
        var buttons = new StackPanel { Spacing = 4, Margin = new Thickness(8, 0, 0, 0), IsVisible = r.View != null, VerticalAlignment = VerticalAlignment.Top, Children = { view, site } };
        var text = new StackPanel
        {
            Spacing = 2,
            Children =
            {
                new TextBlock { Text = r.Title, FontWeight = FontWeight.Bold, FontSize = 15, TextWrapping = TextWrapping.Wrap },
                new TextBlock { Text = r.Body, TextWrapping = TextWrapping.Wrap, Opacity = 0.8, IsVisible = r.Body != "" },
            },
        };
        _list.Children.Add(new DockPanel { Children = { buttons, text } });
        DockPanel.SetDock(buttons, Dock.Right);
        Show();
        PlaceInCorner();
        // The Windows reminder sound (the window replaces the toast that used to play it).
        if (OperatingSystem.IsWindows()) PlaySound("Notification.Reminder", IntPtr.Zero, SndAlias | SndAsync);
    }

    private const uint SndAsync = 0x1, SndAlias = 0x10000;

    [System.Runtime.InteropServices.LibraryImport("winmm.dll", EntryPoint = "PlaySoundW", StringMarshalling = System.Runtime.InteropServices.StringMarshalling.Utf16)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static partial bool PlaySound(string sound, IntPtr module, uint flags);

    private void PlaceInCorner()
    {
        if ((Screens.ScreenFromWindow(this) ?? Screens.Primary) is not { } screen) return;
        var area = screen.WorkingArea;
        var size = PixelSize.FromSize(Bounds.Size, screen.Scaling);
        var margin = (int)(16 * screen.Scaling);
        Position = new PixelPoint(area.Right - size.Width - margin, area.Bottom - size.Height - margin);
    }

    private void Dismiss()
    {
        _items.Clear();
        _list.Children.Clear();
        Hide();
    }

    private void Snooze(TimeSpan delay)
    {
        var later = _items.ToList();
        Dismiss();
        DispatcherTimer.RunOnce(() => later.ForEach(Add), delay);
    }
}
