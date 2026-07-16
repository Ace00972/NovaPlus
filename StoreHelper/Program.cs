using System;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Services.Store;

// NovaPlus Store IAP helper.
//
// Usage:
//   StoreHelper.exe checklicense <storeId>
//   StoreHelper.exe purchase <storeId> [hwnd]
//
// Always prints exactly one line of JSON to stdout and exits.
// This replaces the earlier attempt at a native Node addon
// (@nodert-win10-rs4/windows.services.store), which turned out to be a
// 5-year-old unmaintained package that wouldn't compile against a modern
// Electron/node-gyp/Visual Studio toolchain. This C# helper uses the same
// Windows.Services.Store API, but through Microsoft's actively-maintained
// CsWinRT projection (net8.0-windows10.0.19041.0 target) — no node-gyp,
// no Python, no native compilation step at all on the Electron side.
// Electron's main process spawns this exe via child_process and reads
// the single JSON line back over stdout.

namespace NovaPlusStoreHelper;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length < 2)
        {
            WriteJson(new { success = false, available = false, error = "usage: StoreHelper.exe <checklicense|purchase> <storeId> [hwnd]" });
            return 1;
        }

        string command = args[0].ToLowerInvariant();
        string storeId = args[1];
        long hwnd = args.Length > 2 && long.TryParse(args[2], out var parsedHwnd) ? parsedHwnd : 0;

        try
        {
            switch (command)
            {
                case "checklicense":
                    await CheckLicenseAsync(storeId);
                    break;
                case "purchase":
                    await PurchaseAsync(storeId, hwnd);
                    break;
                default:
                    WriteJson(new { success = false, available = false, error = $"unknown command '{command}'" });
                    return 1;
            }
        }
        catch (Exception e)
        {
            // Any failure here (no package identity, e.g. running unpackaged
            // or sideloaded without a Store association) lands here — same
            // "gracefully unavailable" behavior as before, just from a
            // different process.
            WriteJson(new { success = false, available = false, owned = false, error = e.Message });
            return 1;
        }

        return 0;
    }

    private static async Task CheckLicenseAsync(string storeId)
    {
        var context = StoreContext.GetDefault();
        var license = await context.GetAppLicenseAsync();

        bool owned = false;
        if (license.AddOnLicenses.TryGetValue(storeId, out var addOnLicense))
        {
            owned = addOnLicense.IsActive;
        }

        WriteJson(new { available = true, owned });
    }

    private static async Task PurchaseAsync(string storeId, long hwnd)
    {
        var context = StoreContext.GetDefault();

        // Desktop Bridge / Win32 apps must tell StoreContext which window
        // owns its modal purchase dialog, or RequestPurchaseAsync can
        // silently fail with no dialog and no error. This is the officially
        // documented interop call for exactly this situation —
        // see: https://aka.ms/storecontext-for-desktop
        if (hwnd != 0)
        {
            WinRT.Interop.InitializeWithWindow.Initialize(context, new IntPtr(hwnd));
        }

        var result = await context.RequestPurchaseAsync(storeId);

        // StorePurchaseStatus: Succeeded=0, AlreadyPurchased=1, NotPurchased=2, NetworkError=3, ServerError=4
        bool success = result.Status == StorePurchaseStatus.Succeeded
                    || result.Status == StorePurchaseStatus.AlreadyPurchased;

        WriteJson(new { success, status = (int)result.Status });
    }

    private static void WriteJson(object payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(payload));
    }
}
