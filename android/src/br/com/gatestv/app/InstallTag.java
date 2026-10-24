package br.com.gatestv.app;

import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Lê a chave de ativação que o servidor grava no APK na hora do download.
 *
 * A chave fica num par "GTV1" dentro do APK Signing Block (no espaço de preenchimento), região que a
 * assinatura do APK não cobre: o arquivo continua válido e o Android instala normalmente. Assim o app
 * baixado pelo link do cliente já sabe de quem é e ativa sozinho, sem código nem CPF.
 */
final class InstallTag {
    private static final int ID_GTV1 = 0x31565447; // "GTV1"
    private static final String MAGIC = "APK Sig Block 42";

    private InstallTag() {
    }

    /** A chave gravada no APK, ou "" se ele não tiver (instalado por pen drive, versão antiga…). */
    static String read(String apkPath) {
        try (RandomAccessFile f = new RandomAccessFile(apkPath, "r")) {
            long len = f.length();
            // Fim do ZIP (EOCD): procura a assinatura 0x06054b50 nos últimos 64 KB.
            int tail = (int) Math.min(len, 65557);
            byte[] end = new byte[tail];
            f.seek(len - tail);
            f.readFully(end);
            int eocd = -1;
            for (int i = tail - 22; i >= 0; i--) {
                if (end[i] == 0x50 && end[i + 1] == 0x4b && end[i + 2] == 0x05 && end[i + 3] == 0x06) {
                    eocd = i;
                    break;
                }
            }
            if (eocd < 0) return "";
            long cd = u32(end, eocd + 16);
            if (cd < 32 || cd > len) return "";
            // Rodapé do Signing Block: tamanho (8 bytes) + "APK Sig Block 42".
            byte[] foot = new byte[24];
            f.seek(cd - 24);
            f.readFully(foot);
            if (!MAGIC.equals(new String(foot, 8, 16, StandardCharsets.ISO_8859_1))) return "";
            long size = u64(foot, 0);
            if (size < 24 || size > 8 * 1024 * 1024 || size > cd) return "";
            long start = cd - size - 8;
            byte[] block = new byte[(int) (size - 24)];
            f.seek(start + 8);
            f.readFully(block);
            int p = 0;
            while (p + 12 <= block.length) {
                long n = u64(block, p);
                if (n < 4 || p + 8 + n > block.length) break;
                if ((int) u32(block, p + 8) == ID_GTV1) {
                    String v = new String(block, p + 12, (int) n - 4, StandardCharsets.UTF_8).trim();
                    return v.matches("[A-Za-z0-9_-]{8,80}") ? v : "";
                }
                p += 8 + (int) n;
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private static long u32(byte[] b, int o) {
        return (b[o] & 0xffL) | (b[o + 1] & 0xffL) << 8 | (b[o + 2] & 0xffL) << 16 | (b[o + 3] & 0xffL) << 24;
    }

    private static long u64(byte[] b, int o) {
        return u32(b, o) | u32(b, o + 4) << 32;
    }

    // Teste no computador: java InstallTag.java arquivo.apk
    public static void main(String[] args) {
        System.out.println("chave: '" + read(args[0]) + "'");
    }
}
