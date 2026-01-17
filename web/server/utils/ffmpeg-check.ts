import { spawn } from 'child_process';
import { platform } from 'os';

interface FFmpegCheckResult {
  available: boolean;
  version?: string;
  error?: string;
  installHint?: string;
}

/**
 * Check if ffmpeg is available on the system
 */
export async function checkFFmpeg(): Promise<FFmpegCheckResult> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';

    ffmpeg.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        // Extract version from first line: "ffmpeg version X.X.X ..."
        const versionMatch = stdout.match(/ffmpeg version (\S+)/);
        resolve({
          available: true,
          version: versionMatch ? versionMatch[1] : 'unknown'
        });
      } else {
        resolve({
          available: false,
          error: 'ffmpeg exited with error',
          installHint: getInstallHint()
        });
      }
    });

    ffmpeg.on('error', () => {
      resolve({
        available: false,
        error: 'ffmpeg not found in PATH',
        installHint: getInstallHint()
      });
    });
  });
}

/**
 * Check if ffprobe is available on the system
 */
export async function checkFFprobe(): Promise<FFmpegCheckResult> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const versionMatch = stdout.match(/ffprobe version (\S+)/);
        resolve({
          available: true,
          version: versionMatch ? versionMatch[1] : 'unknown'
        });
      } else {
        resolve({
          available: false,
          error: 'ffprobe exited with error',
          installHint: getInstallHint()
        });
      }
    });

    ffprobe.on('error', () => {
      resolve({
        available: false,
        error: 'ffprobe not found in PATH',
        installHint: getInstallHint()
      });
    });
  });
}

/**
 * Get platform-specific installation instructions
 */
function getInstallHint(): string {
  const os = platform();

  switch (os) {
    case 'darwin':
      return 'Install with Homebrew: brew install ffmpeg';
    case 'win32':
      return 'Download from https://ffmpeg.org/download.html or install with: choco install ffmpeg';
    case 'linux':
      return 'Install with your package manager: sudo apt install ffmpeg (Debian/Ubuntu) or sudo dnf install ffmpeg (Fedora)';
    default:
      return 'Download from https://ffmpeg.org/download.html';
  }
}

/**
 * Run all checks and return combined result
 */
export async function checkDependencies(): Promise<{
  ffmpeg: FFmpegCheckResult;
  ffprobe: FFmpegCheckResult;
  allAvailable: boolean;
}> {
  const [ffmpeg, ffprobe] = await Promise.all([
    checkFFmpeg(),
    checkFFprobe()
  ]);

  return {
    ffmpeg,
    ffprobe,
    allAvailable: ffmpeg.available && ffprobe.available
  };
}
