import { ChildProcess, fork } from 'child_process';
import { Compilation, Compiler, WebpackPluginInstance } from 'webpack';

export type RunScriptWebpackPluginOptions = {
  autoRestart?: boolean;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  keyboard: boolean;
  name?: string;
  nodeArgs: string[];
  restartable?: boolean;
  signal: boolean | string;
};

function getSignal(signal: string | boolean) {
  // allow users to disable sending a signal by setting to `false`...
  if (signal === false) return;
  if (signal === true) return 'SIGUSR2';
  return signal;
}

export class RunScriptWebpackPlugin implements WebpackPluginInstance {
  private readonly options: RunScriptWebpackPluginOptions;

  private worker?: ChildProcess;

  private _entrypoint?: string;

  constructor(options: Partial<RunScriptWebpackPluginOptions> = {}) {
    this.options = {
      autoRestart: true,
      signal: false,
      // Only listen on keyboard in development, so the server doesn't hang forever
      keyboard: process.env.NODE_ENV === 'development',
      ...options,
      args: [...(options.args || [])],
      nodeArgs: options.nodeArgs || process.execArgv,
    };

    if (this.options.restartable) {
      this._enableRestarting();
    }
  }

  private _enableRestarting(): void {
    if (this.options.keyboard) {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (data: string) => {
        if (data.trim() === 'rs') {
          this._restartServer();
        }
      });
    }
  }

  private _restartServer(): void {
    console.log('Restarting app...');

    this._stopServer();

    this._startServer();
  }

  private afterEmit = (compilation: Compilation, cb: () => void): void => {
    if (this.worker && this.worker.connected && this.worker?.pid) {
      if (this.options.autoRestart) {
        this._restartServer();
        cb();
        return;
      }
      this._stopServer();
      cb();
      return;
    }

    this.startServer(compilation, cb);
  };

  apply = (compiler: Compiler): void => {
    compiler.hooks.afterEmit.tapAsync(
      { name: 'RunScriptPlugin' },
      this.afterEmit,
    );
  };

  private startServer = (compilation: Compilation, cb: () => void): void => {
    const { assets, compiler } = compilation;
    const { options } = this;
    let name;
    const names = Object.keys(assets);
    if (options.name) {
      name = options.name;
      if (!assets[name]) {
        console.error(
          `Entry ${name} not found. Try one of: ${names.join(' ')}`,
        );
      }
    } else {
      name = names[0];
      if (names.length > 1) {
        console.log(
          `More than one entry built, selected ${name}. All names: ${names.join(
            ' ',
          )}`,
        );
      }
    }
    if (!compiler.options.output || !compiler.options.output.path) {
      throw new Error('output.path should be defined in webpack config!');
    }

    this._entrypoint = `${compiler.options.output.path}/${name}`;
    this._startServer(cb);
  };

  private _startServer(cb?: () => void): void {
    const { args, nodeArgs, cwd, env } = this.options;
    if (!this._entrypoint) throw new Error('run-script-webpack-plugin requires an entrypoint.');

    const child = fork(this._entrypoint, args, {
      execArgv: nodeArgs,
      stdio: 'inherit',
      cwd,
      env,
    });

    setTimeout(() => {
      this.worker = child;
      cb?.()
    }, 0);
  }

  private _stopServer() {
    const signal = getSignal(this.options.signal);
    if (this.worker?.pid) {
      process.kill(this.worker.pid, signal);
    }
  };
}
