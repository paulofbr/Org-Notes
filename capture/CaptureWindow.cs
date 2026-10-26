using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;

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
    // Links and images, as the web editor's tools: a link goes where the cursor was in the title or the notes.
    private readonly TextBox _linkUrl = new() { PlaceholderText = L.Tr("Endereço (https://…)") };
    private readonly TextBox _linkText = new() { PlaceholderText = L.Tr("Texto (opcional)") };
    private readonly Grid _linkPanel = new() { ColumnDefinitions = new("2*,*,Auto"), ColumnSpacing = 8, IsVisible = false };
    private TextBox _linkTarget;
    private (int Start, int End) _linkAt;
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

        _linkTarget = _body;
        _title.GotFocus += (_, _) => _linkTarget = _title;
        _body.GotFocus += (_, _) => _linkTarget = _body;
        var insertLink = new Button { Content = L.Tr("Inserir") };
        insertLink.Click += (_, _) => InsertLink();
        Grid.SetColumn(_linkText, 1);
        Grid.SetColumn(insertLink, 2);
        _linkPanel.Children.Add(_linkUrl);
        _linkPanel.Children.Add(_linkText);
        _linkPanel.Children.Add(insertLink);
        var link = new Button { Content = L.Tr("Link (Ctrl+L)") };
        link.Click += (_, _) => OpenLink();
        var image = new Button { Content = L.Tr("Imagem") };
        image.Click += async (_, _) => await AddImage();
        var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { link, image } };
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
                tools,
                _linkPanel,
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

    /// <summary>Opens the link panel for the title or notes box last used, keeping its selection as the link's text.</summary>
    private void OpenLink()
    {
        var text = _linkTarget.Text ?? "";
        var start = Math.Clamp(Math.Min(_linkTarget.SelectionStart, _linkTarget.SelectionEnd), 0, text.Length);
        var end = Math.Clamp(Math.Max(_linkTarget.SelectionStart, _linkTarget.SelectionEnd), start, text.Length);
        _linkAt = (start, end);
        _linkUrl.Text = "";
        _linkText.Text = text[start..end];
        _linkPanel.IsVisible = true;
        _linkUrl.Focus();
    }

    private void InsertLink()
    {
        var url = _linkUrl.Text?.Trim();
        if (string.IsNullOrEmpty(url)) return;
        var text = _linkText.Text?.Trim();
        _linkPanel.IsVisible = false;
        Insert(_linkTarget, string.IsNullOrEmpty(text) ? $"[[{url}]]" : $"[[{url}][{text}]]", _linkAt.Start, _linkAt.End);
    }

    private static void Insert(TextBox box, string value, int start, int end)
    {
        var text = box.Text ?? "";
        start = Math.Clamp(start, 0, text.Length);
        end = Math.Clamp(end, start, text.Length);
        box.Text = text[..start] + value + text[end..];
        box.Focus();
        box.CaretIndex = start + value.Length;
    }

    /// <summary>Uploads a picked image next to the chosen file's notes and links it in the notes, as the web does.</summary>
    private async Task AddImage()
    {
        if (_selected is not { } t) return;
        var at = _body.CaretIndex;
        var picked = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = false,
            FileTypeFilter = [new FilePickerFileType(L.Tr("Imagens")) { Patterns = ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp"] }],
        });
        if (picked.Count == 0) return;
        _status.Text = L.Tr("A carregar imagem…");
        try
        {
            await using var stream = await picked[0].OpenReadAsync();
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer);
            var path = await _api.UploadImage(t.File, buffer.ToArray());
            // Relative to the notes' file, as org (and the web) write file links.
            var dir = Path.GetDirectoryName(t.File)?.Replace('\\', '/') ?? "";
            var link = dir == "" ? path : Path.GetRelativePath(dir, path).Replace('\\', '/');
            Insert(_body, $"[[file:{link}]]", at, at);
            _status.Text = "";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            _status.Text = e.Message;
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
        var inLinkPanel = FocusManager?.GetFocusedElement() is var f && (f == _linkUrl || f == _linkText);
        if (e.Key == Key.Escape && _linkPanel.IsVisible)
        {
            _linkPanel.IsVisible = false;
            _linkTarget.Focus();
        }
        else if (e.Key == Key.Enter && inLinkPanel && e.KeyModifiers == KeyModifiers.None) InsertLink();
        else if (e.Key == Key.L && e.KeyModifiers == KeyModifiers.Control) OpenLink();
        else if (e.Key == Key.Escape) Hide();
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
