using System.Runtime.Versioning;
using Microsoft.Win32;

namespace OrgNotes.Capture;

/// <summary>Starts the app at Windows sign-in through the user's Run key (no installer or admin rights needed).</summary>
[SupportedOSPlatform("windows")]
public static class WindowsStartup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "OrgNotesCapture";

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(Name) != null;
        }
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue(Name, $"\"{Environment.ProcessPath}\"");
        else key.DeleteValue(Name, throwOnMissingValue: false);
    }
}
