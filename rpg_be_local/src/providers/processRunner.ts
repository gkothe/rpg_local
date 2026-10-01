import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { Problem } from '../errors.js';
export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  captureDiagnosticOutput?: boolean;
};
export function runProcess(
  binary: string,
  args: string[],
  input: string,
  options: RunOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Problem(409, 'cancelled', 'Request cancelled'));
      return;
    }
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    let failure: Error | undefined;
    const outputDecoder = new StringDecoder('utf8');
    const errorDecoder = new StringDecoder('utf8');
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill());
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(options.captureDiagnosticOutput ? output + stderr : output);
    };
    const stop = (error: Error) => {
      if (failure || settled) return;
      failure = error;
      kill();
    };
    const cancel = () => stop(new Problem(409, 'cancelled', 'Request cancelled'));
    const timer = setTimeout(
      () => stop(new Problem(504, 'provider_timeout', 'Local process timed out')),
      options.timeoutMs ?? 180000
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.on('error', () =>
      finish(
        new Problem(
          503,
          'process_unavailable',
          'Local executable could not be started; check installation'
        )
      )
    );
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 2_000_000))
        stop(new Problem(502, 'provider_output', 'Local process exceeded output limit'));
      else output += outputDecoder.write(chunk);
    });
    // Never return raw stderr: it can include local paths, prompts or credentials.
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 2_000_000))
        stop(new Problem(502, 'provider_output', 'Local process exceeded output limit'));
      else stderr += errorDecoder.write(chunk);
    });
    child.on('close', (code) => {
      output += outputDecoder.end();
      stderr += errorDecoder.end();
      finish(
        failure ??
          (code === 0
            ? undefined
            : new Problem(
                502,
                'provider_failure',
                /login|auth|sign.?in/i.test(stderr + output)
                  ? 'Local CLI requires login; authenticate in its own terminal'
                  : 'Local process failed; inspect its own diagnostics and account/model availability'
              ))
      );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
