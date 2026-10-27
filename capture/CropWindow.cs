using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using SkiaSharp;

namespace OrgNotes.Capture;

/// <summary>Crops an image, as the web's image dialog: drag over it to choose the area; the result is a PNG.</summary>
public class CropWindow : Window
{
    private readonly byte[] _image;
    private readonly Bitmap _bitmap;
    private readonly Image _view;
    private readonly Rectangle _box = new() { Stroke = Brushes.White, StrokeThickness = 2, StrokeDashArray = [4, 3], Fill = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)), IsVisible = false, IsHitTestVisible = false };
    private readonly Button _crop = new() { Content = L.Tr("Recortar"), Classes = { "accent" }, IsEnabled = false };
    private Point? _start;
    private Rect _selection;

    public CropWindow(byte[] image)
    {
        _image = image;
        _bitmap = new Bitmap(new MemoryStream(image));
        _view = new Image { Source = _bitmap, Stretch = Stretch.Uniform, MaxWidth = 800, MaxHeight = 560 };
        Title = L.Tr("Recortar imagem");
        SizeToContent = SizeToContent.WidthAndHeight;
        CanResize = false;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;

        // A transparent canvas over the image takes the drag and shows the chosen area.
        var canvas = new Canvas { Background = Brushes.Transparent, Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Cross), Children = { _box } };
        canvas.PointerPressed += (_, e) => (_start, _box.IsVisible, _crop.IsEnabled) = (Clamp(e.GetPosition(_view)), false, false);
        canvas.PointerMoved += (_, e) =>
        {
            if (_start is not { } s) return;
            var p = Clamp(e.GetPosition(_view));
            _selection = new Rect(Math.Min(s.X, p.X), Math.Min(s.Y, p.Y), Math.Abs(p.X - s.X), Math.Abs(p.Y - s.Y));
            Canvas.SetLeft(_box, _selection.X);
            Canvas.SetTop(_box, _selection.Y);
            (_box.Width, _box.Height, _box.IsVisible) = (_selection.Width, _selection.Height, true);
        };
        canvas.PointerReleased += (_, _) =>
        {
            _start = null;
            _crop.IsEnabled = _selection.Width > 4 && _selection.Height > 4;
        };

        var cancel = new Button { Content = L.Tr("Cancelar") };
        cancel.Click += (_, _) => Close(null);
        _crop.Click += (_, _) => Close(Crop());
        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 10,
            Children =
            {
                new TextBlock { Text = L.Tr("Arrasta sobre a imagem para escolher a área a recortar."), Opacity = 0.7 },
                new Grid { Children = { _view, canvas } },
                new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { cancel, _crop } },
            },
        };
    }

    private Point Clamp(Point p) => new(Math.Clamp(p.X, 0, _view.Bounds.Width), Math.Clamp(p.Y, 0, _view.Bounds.Height));

    /// <summary>The chosen area of the full-size image (the selection is drawn on the shown, scaled one), as a PNG.</summary>
    private byte[]? Crop()
    {
        using var source = SKBitmap.Decode(_image);
        var scale = source.Width / _view.Bounds.Width;
        var area = new SKRectI((int)(_selection.X * scale), (int)(_selection.Y * scale), (int)(_selection.Right * scale), (int)(_selection.Bottom * scale));
        area.Intersect(new SKRectI(0, 0, source.Width, source.Height));
        if (area.IsEmpty) return null;
        using var cropped = new SKBitmap(area.Width, area.Height);
        using (var canvas = new SKCanvas(cropped)) canvas.DrawBitmap(source, area, new SKRect(0, 0, area.Width, area.Height));
        using var image = SKImage.FromBitmap(cropped);
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }
}
