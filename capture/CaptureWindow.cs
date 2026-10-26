using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace OrgNotes.Capture;

/// <summary>
/// Same flow as the web capture dialog: press a template's key (or Enter for the selected one), type the title,
/// optional date/time and notes, Ctrl+Enter saves, Esc hides.
/// </summary>
public class CaptureWindow : Window
{
    private readonly Api _api;
    private readonly ComboBox _templates = new() { HorizontalAlignment = HorizontalAlignment.Stretch, PlaceholderText = L.Tr("Ficheiro") };
    private readonly TextBox _title = new() { PlaceholderText = L.Tr("Título") };
    // One box per empty property of the selected template, like the web dialog.
    private readonly StackPanel _props = new() { Spacing = 10 };
    private readonly CalendarDatePicker _date = new() { PlaceholderText = L.Tr("Data"), HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TextBox _time = new() { PlaceholderText = L.Tr("Hora (HH:MM)"), Width = 130 };
    private readonly Grid _when = new() { ColumnDefinitions = new("*,Auto"), ColumnSpacing = 8 };
    private readonly TextBox _body = new()
    {
        PlaceholderText = L.Tr("Notas (opcional, sintaxe org)"),
        AcceptsReturn = true,
        TextWrapping = TextWrapping.Wrap,
        Height = 120,
        FontFamily = new FontFamily("monospace"),
    };
    private readonly TextBlock _status = new() { Opacity = 0.7, TextWrapping = TextWrapping.Wrap };
    private readonly Button _save = new() { Content = L.Tr("Guardar (Ctrl+Enter)"), IsDefault = false, Classes = { "accent" } };
    // Four-point sparkle, like the web's AI button.
    private readonly Button _ai = new()
    {
        Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            Children =
            {
                new PathIcon { Data = Geometry.Parse("M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"), Width = 16, Height = 16 },
                new TextBlock { Text = "▾", VerticalAlignment = VerticalAlignment.Center },
            },
        },
        IsVisible = false,
    };

    // Same modes as the web; ids match the server's AiAssistant.Modes.
    private readonly (string Id, string Label, string? Gesture)[] AiModes =
    [
        ("develop", L.Tr("Desenvolver"), "Alt+R"),
        ("fix", L.Tr("Corrigir"), "Alt+Shift+R"),
        ("summarize", L.Tr("Resumir"), null),
        ("formal", L.Tr("Tom profissional"), null),
        ("tasks", L.Tr("Extrair tarefas"), null),
    ];
    private readonly AiReviewPanel _aiPanel = new();
    private List<Template> _list = [];
    private bool _discarded;

    /// <summary>Raised when the server says the user's language differs from the one this window was built in.</summary>
    public event Action<string>? LanguageChanged;
    private Template? _selected;

    public CaptureWindow(Api api)
    {
        _api = api;
        Title = L.Tr("Capturar · Org Notes");
        Width = 560;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        _when.Children.Add(_date);
        Grid.SetColumn(_time, 1);
        _when.Children.Add(_time);
        var cancel = new Button { Content = L.Tr("Cancelar") };
        cancel.Click += (_, _) => Hide();
        _save.Click += async (_, _) => await Save();
        ToolTip.SetTip(_ai, L.Tr("IA: desenvolver, corrigir, resumir… (Alt+R)"));
        var flyout = new MenuFlyout { Placement = PlacementMode.TopEdgeAlignedLeft };
        foreach (var (id, label, gesture) in AiModes)
        {
            var item = new MenuItem { Header = label, InputGesture = gesture is null ? null : KeyGesture.Parse(gesture) };
            item.Click += async (_, _) => await Review(id);
            flyout.Items.Add(item);
        }
        _ai.Flyout = flyout;
        _aiPanel.Accepted += f =>
        {
            _title.Text = f["title"];
            _body.Text = f["body"];
        };
        var actions = new Grid { ColumnDefinitions = new("Auto,*,Auto") };
        actions.Children.Add(_ai);
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        Grid.SetColumn(right, 2);
        actions.Children.Add(right);
        _templates.SelectionChanged += (_, _) => Select(_templates.SelectedIndex >= 0 ? _list[_templates.SelectedIndex] : null);
        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 10,
            Children =
            {
                _templates,
                new TextBlock { Text = L.Tr("Escolhe o ficheiro na lista (↑ ↓) ou pela tecla do template; Enter passa ao título."), Opacity = 0.6, FontSize = 12 },
                _title,
                _props,
                _when,
                _body,
                _status,
                _aiPanel,
                actions,
            },
        };

        // Hide instead of closing so the next capture opens instantly.
        Closing += (_, e) =>
        {
            if (_discarded) return;
            e.Cancel = true;
            Hide();
        };
        right.Children.Add(cancel);
        right.Children.Add(_save);
        AddHandler(KeyDownEvent, OnKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);
    }

    public async void ShowForCapture()
    {
        _title.Text = _body.Text = _time.Text = "";
        _date.SelectedDate = null;
        _aiPanel.IsVisible = false;
        _status.Text = L.Tr("A carregar templates…");
        Show();
        Activate();
        _templates.Focus();
        try
        {
            _list = await _api.Templates();
            var me = await _api.Me();
            if (L.Langs.Contains(me.Lang) && me.Lang != L.Lang)
            {
                LanguageChanged?.Invoke(me.Lang!);
                return;
            }
            _ai.IsVisible = me.Ai;
            RenderTemplates();
            Select(_list.FirstOrDefault(t => t.File == _selected?.File && t.Key == _selected?.Key) ?? _list.FirstOrDefault());
            _status.Text = _list.Count == 0 ? L.Tr("Nenhum ficheiro tem template de captura.") : "";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = L.Tr("Não foi possível ligar ao servidor: {0}", e.Message);
        }
        // Anything else would leave the window stuck on "loading" with no list: show it instead.
        catch (Exception e)
        {
            _status.Text = $"{e.GetType().Name}: {e.Message}";
        }
    }

    /// <summary>Closes the window for good, e.g. to rebuild it in another language.</summary>
    public void Discard()
    {
        _discarded = true;
        Close();
    }

    private void RenderTemplates() => _templates.ItemsSource = _list.Select(t => $"{t.Key}   {t.Name}  →  {t.File}").ToList();

    private void Select(Template? t)
    {
        _selected = t;
        var i = t is null ? -1 : _list.IndexOf(t);
        if (_templates.SelectedIndex != i) _templates.SelectedIndex = i;
        _when.IsVisible = t?.UsesWhen == true;
        _props.Children.Clear();
        foreach (var p in t?.Props ?? [])
            _props.Children.Add(t!.Options?.GetValueOrDefault(p) is { } options
                ? new AutoCompleteBox { PlaceholderText = p, Tag = p, ItemsSource = options, MinimumPrefixLength = 0, FilterMode = AutoCompleteFilterMode.Contains, HorizontalAlignment = HorizontalAlignment.Stretch }
                : new TextBox { PlaceholderText = p, Tag = p });
    }

    private async void OnKey(object? sender, KeyEventArgs e)
    {
        var typing = FocusManager?.GetFocusedElement() is TextBox;
        Template? hit = null;
        // While the list is open, Enter/Esc/arrows belong to it.
        if (_templates.IsDropDownOpen && e.Key is Key.Enter or Key.Escape or Key.Up or Key.Down) return;
        if (e.Key == Key.Escape) Hide();
        else if (e.Key == Key.R && e.KeyModifiers == KeyModifiers.Alt) await Review("develop");
        else if (e.Key == Key.R && e.KeyModifiers == (KeyModifiers.Alt | KeyModifiers.Shift)) await Review("fix");
        else if (e.Key == Key.Enter && e.KeyModifiers.HasFlag(KeyModifiers.Control)) await Save();
        else if (!typing && e.Key == Key.Enter) _title.Focus();
        else if (!typing && e.KeySymbol is { Length: 1 } k && (hit = _list.FirstOrDefault(t => t.Key == k)) != null)
        {
            _templates.IsDropDownOpen = false;
            Select(hit);
            _title.Focus();
        }
        else return;
        e.Handled = true;
    }

    private readonly string[] ReviewMessages =
    [
        L.Tr("A afiar o lápis vermelho…"),
        L.Tr("A consultar a professora de Português…"),
        L.Tr("À caça de acentos fugitivos…"),
        L.Tr("A pôr as vírgulas no sítio…"),
        L.Tr("A tirar o pó ao dicionário…"),
        L.Tr("A convencer o corretor ortográfico a trabalhar ao domingo…"),
        L.Tr("A procurar o «ç» que caiu atrás do sofá…"),
        L.Tr("A passar a limpo, com letra bonita…"),
    ];

    private async Task Review(string mode)
    {
        var fields = new Dictionary<string, string> { ["title"] = _title.Text ?? "", ["body"] = _body.Text ?? "" };
        if (!_ai.IsVisible || !_ai.IsEnabled || fields.Values.All(string.IsNullOrWhiteSpace)) return;
        _ai.IsEnabled = false;
        _aiPanel.ShowMessage(ReviewMessages[Random.Shared.Next(ReviewMessages.Length)]);
        try
        {
            _aiPanel.ShowResult(fields, await _api.Improve(fields, mode), new() { ["title"] = L.Tr("Título"), ["body"] = L.Tr("Notas") });
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _aiPanel.ShowMessage(e.Message);
        }
        finally
        {
            _ai.IsEnabled = true;
        }
    }

    private async Task Save()
    {
        if (_selected is not { } t || string.IsNullOrWhiteSpace(_title.Text)) return;
        TimeOnly? time = null;
        if (_when.IsVisible && !string.IsNullOrWhiteSpace(_time.Text))
        {
            if (!TimeOnly.TryParse(_time.Text, out var parsed))
            {
                _status.Text = L.Tr("Hora inválida (usa HH:MM).");
                return;
            }
            time = parsed;
        }
        DateOnly? date = _when.IsVisible && _date.SelectedDate is { } d ? DateOnly.FromDateTime(d) : null;
        _save.IsEnabled = false;
        try
        {
            var props = _props.Children.ToDictionary(c => (string)c.Tag!, c => (c as TextBox)?.Text ?? (c as AutoCompleteBox)?.Text ?? "");
            await _api.Capture(t, _title.Text.Trim(), _body.Text ?? "", date, date is null ? null : time, props);
            Hide();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = e.Message;
        }
        finally
        {
            _save.IsEnabled = true;
        }
    }
}
