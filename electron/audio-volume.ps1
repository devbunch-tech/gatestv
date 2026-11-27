# Volume dos outros apps no Windows (Core Audio), usado por electron/audio-volume.cjs.
# Fica rodando: recebe um pedido JSON por linha no stdin e responde uma linha JSON no stdout.
#   {"id":1,"cmd":"list"}  {"id":2,"cmd":"volume","pid":123,"v":0.5}  {"id":3,"cmd":"mute","pid":123,"m":true}
# C# compilado uma vez (Add-Type), sem módulo nativo. Só C# 5 (compilador do .NET Framework).
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace GatesAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    [PreserveSig] int GetGroupingParam(out Guid group);
    [PreserveSig] int SetGroupingParam(ref Guid group, ref Guid ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out int pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute(bool mute, ref Guid ctx);
    [PreserveSig] int GetMute(out bool mute);
  }

  public static class Mixer {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetPackageFullName(IntPtr h, ref int len, StringBuilder name);
    delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder s, int max);

    static Guid Ctx = Guid.Empty;
    static Guid IID_Manager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    class Sess { public int Pid; public int State; public string Display; public IAudioSessionControl2 Ctl; }

    // Todas as sessões (não expiradas) de todos os dispositivos de saída ativos.
    static List<Sess> Sessions() {
      var list = new List<Sess>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
      IMMDeviceCollection devs;
      Check(en.EnumAudioEndpoints(0 /* eRender */, 1 /* ACTIVE */, out devs));
      int n; Check(devs.GetCount(out n));
      for (int d = 0; d < n; d++) {
        IMMDevice dev; if (devs.Item(d, out dev) != 0) continue;
        object o; Guid iid = IID_Manager2;
        if (dev.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o) != 0) { Marshal.ReleaseComObject(dev); continue; }
        var mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator ss;
        if (mgr.GetSessionEnumerator(out ss) == 0) {
          int c; ss.GetCount(out c);
          for (int i = 0; i < c; i++) {
            IAudioSessionControl2 ctl; if (ss.GetSession(i, out ctl) != 0 || ctl == null) continue;
            int st; ctl.GetState(out st);
            int pid; ctl.GetProcessId(out pid);
            if (st == 2 || pid == 0 || ctl.IsSystemSoundsSession() == 0) { Marshal.ReleaseComObject(ctl); continue; }
            string dn; ctl.GetDisplayName(out dn);
            list.Add(new Sess { Pid = pid, State = st, Display = dn, Ctl = ctl });
          }
          Marshal.ReleaseComObject(ss);
        }
        Marshal.ReleaseComObject(mgr); Marshal.ReleaseComObject(dev);
      }
      Marshal.ReleaseComObject(devs); Marshal.ReleaseComObject(en);
      return list;
    }

    static void Release(List<Sess> list) { foreach (var s in list) Marshal.ReleaseComObject(s.Ctl); }
    static void Check(int hr) { if (hr != 0) Marshal.ThrowExceptionForHR(hr); }

    static string ImagePath(IntPtr h) {
      var sb = new StringBuilder(1024); int size = sb.Capacity;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    }
    static string Package(IntPtr h) {
      int len = 0;
      if (GetPackageFullName(h, ref len, null) != 122 /* ERROR_INSUFFICIENT_BUFFER */ || len <= 0) return "";
      var sb = new StringBuilder(len);
      return GetPackageFullName(h, ref len, sb) == 0 ? sb.ToString() : "";
    }

    // Título de uma janela visível do processo (apps UWP: janela filha dentro do ApplicationFrameHost).
    static Dictionary<int, string> Titles() {
      var t = new Dictionary<int, string>();
      EnumWindows(delegate(IntPtr hwnd, IntPtr lp) {
        if (!IsWindowVisible(hwnd)) return true;
        var sb = new StringBuilder(512);
        if (GetWindowText(hwnd, sb, 512) == 0) return true;
        string title = sb.ToString();
        int pid; GetWindowThreadProcessId(hwnd, out pid);
        if (!t.ContainsKey(pid)) t[pid] = title;
        var cls = new StringBuilder(256); GetClassName(hwnd, cls, 256);
        if (cls.ToString() == "ApplicationFrameWindow") {
          EnumChildWindows(hwnd, delegate(IntPtr ch, IntPtr lp2) {
            int cp; GetWindowThreadProcessId(ch, out cp);
            if (cp != pid && !t.ContainsKey(cp)) t[cp] = title;
            return true;
          }, IntPtr.Zero);
        }
        return true;
      }, IntPtr.Zero);
      return t;
    }

    public static string List() {
      var list = Sessions();
      var titles = Titles();
      var sb = new StringBuilder("[");
      var info = new Dictionary<int, string>();
      try {
        foreach (var s in list) {
          float v = 1; bool m = false;
          var vol = (ISimpleAudioVolume)s.Ctl;
          vol.GetMasterVolume(out v); vol.GetMute(out m);
          string pinfo;
          if (!info.TryGetValue(s.Pid, out pinfo)) { pinfo = ProcInfo(s.Pid, titles); info[s.Pid] = pinfo; }
          if (sb.Length > 1) sb.Append(',');
          sb.Append("{\"pid\":").Append(s.Pid)
            .Append(",\"volume\":").Append(v.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture))
            .Append(",\"muted\":").Append(m ? "true" : "false")
            .Append(",\"active\":").Append(s.State == 1 ? "true" : "false")
            .Append(",\"display\":").Append(Str(s.Display))
            .Append(pinfo).Append('}');
        }
      } finally { Release(list); }
      return sb.Append(']').ToString();
    }

    static string ProcInfo(int pid, Dictionary<int, string> titles) {
      string name = "", path = "", desc = "", pkg = "", title = "";
      try {
        var p = Process.GetProcessById(pid);
        name = p.ProcessName;
        try { title = p.MainWindowTitle; } catch {}
        // Navegadores: o som sai de um processo filho sem janela; usa o título da janela do mesmo app.
        if (String.IsNullOrEmpty(title) && !titles.TryGetValue(pid, out title)) {
          title = "";
          foreach (var q in Process.GetProcessesByName(name)) {
            try { if (!String.IsNullOrEmpty(q.MainWindowTitle)) { title = q.MainWindowTitle; break; } } catch {}
          }
        }
      } catch {}
      IntPtr h = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
      if (h != IntPtr.Zero) {
        path = ImagePath(h);
        pkg = Package(h);
        CloseHandle(h);
      }
      if (path.Length > 0) {
        try { desc = FileVersionInfo.GetVersionInfo(path).FileDescription ?? ""; } catch {}
      }
      return ",\"process\":" + Str(name) + ",\"path\":" + Str(path) + ",\"desc\":" + Str(desc) + ",\"pkg\":" + Str(pkg) + ",\"title\":" + Str(title);
    }

    // Ajusta todas as sessões do processo (pode haver uma por dispositivo de saída).
    public static int SetVolume(int pid, float v) {
      var list = Sessions(); int n = 0;
      try {
        foreach (var s in list) if (s.Pid == pid) { Check(((ISimpleAudioVolume)s.Ctl).SetMasterVolume(Math.Max(0f, Math.Min(1f, v)), ref Ctx)); n++; }
      } finally { Release(list); }
      return n;
    }
    public static int SetMute(int pid, bool m) {
      var list = Sessions(); int n = 0;
      try {
        foreach (var s in list) if (s.Pid == pid) { Check(((ISimpleAudioVolume)s.Ctl).SetMute(m, ref Ctx)); n++; }
      } finally { Release(list); }
      return n;
    }

    // JSON só com ASCII (acentos como \uXXXX): não depende da codificação do console.
    public static string Str(string s) {
      if (s == null) return "\"\"";
      var sb = new StringBuilder("\"");
      foreach (char c in s) {
        if (c == '"' || c == '\\') sb.Append('\\').Append(c);
        else if (c < 32 || c > 126) sb.Append("\\u").Append(((int)c).ToString("x4"));
        else sb.Append(c);
      }
      return sb.Append('"').ToString();
    }
  }
}
'@

try {
  Add-Type -TypeDefinition $code -Language CSharp
} catch {
  [Console]::Out.WriteLine('{"ready":false,"error":"' + ($_.Exception.Message -replace '[^\x20-\x7e]', '?' -replace '["\\]', "'") + '"}')
  [Console]::Out.Flush()
  exit 1
}
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break } # o app fechou
  if ($line.Trim() -eq '') { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    switch ($req.cmd) {
      'list' { $data = [GatesAudio.Mixer]::List() }
      'volume' { $data = [GatesAudio.Mixer]::SetVolume([int]$req.pid, [float]$req.v) }
      'mute' { $data = [GatesAudio.Mixer]::SetMute([int]$req.pid, [bool]$req.m) }
      'quit' { exit 0 }
      default { throw "comando desconhecido: $($req.cmd)" }
    }
    $out = '{"id":' + $id + ',"ok":true,"data":' + $data + '}'
  } catch {
    $out = '{"id":' + $id + ',"ok":false,"error":' + [GatesAudio.Mixer]::Str($_.Exception.Message) + '}'
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}

