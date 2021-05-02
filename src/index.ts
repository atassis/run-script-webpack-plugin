import { fork, ChildProcess } from 'child_process';
import { Compiler, WebpackPluginInstance, Compilation } from 'webpack';

export type ProcessKillSignal =
  | 'SIGHUP'
  | 'SIGINT'
  | 'SIGQUIT'
  | 'SIGILL'
  | 'SIGABRT'
  | 'SIGFPE'
  | 'SIGKILL'
  | 'SIGSEGV'
  | 'SIGPIPE'
  | 'SIGALRM'
  | 'SIGTERM'
  | 'SIGUSR1'
  | 'SIGUSR2'
  | 'SIGCHLD'
  | 'SIGCONT'
  | 'SIGSTOP'
  | 'SIGTSTP'
  | 'SIGTTIN'
  | 'SIGTTOU'
  | 'SIGBUS'
  | 'SIGPOLL'
  | 'SIGPROF'
  | 'SIGSYS'
  | 'SIGTRAP'
  | 'SIGURG'
  | 'SIGVTALRM'
  | 'SIGXCPU'
  | 'SIGXFSZ'
  | 'SIGIOT'
  | 'SIGEMT'
  | 'SIGSTKFLT'
  | 'SIGIO'
  | 'SIGCLD'
  | 'SIGPWR'
  | 'SIGINFO'
  | 'SIGLOST'
  | 'SIGWINCH'
  | 'SIGUNUSED';

export type RunScriptWebpackPluginOptions = {
  cleanup?: boolean
  name?: string;
  nodeArgs: string[];
  args: string[];
  signal: boolean | ProcessKillSignal;
  keyboard: boolean;
  cwd?: string;
  restartable?: boolean;
};

function getSignal(signal: ProcessKillSignal | boolean) {
  // allow users to disable sending a signal by setting to `false`...
  if (signal === false) return;
  if (signal === true) return 'SIGUSR2';
  return signal;
}

class RunScriptWebpackPlugin implements WebpackPluginInstance {
  private readonly options: RunScriptWebpackPluginOptions;

  private worker?: ChildProcess;

  private _entrypoint?: string;

  constructor(options: Partial<RunScriptWebpackPluginOptions> = {}) {
    this.options = {
      signal: false,
      cleanup: false,
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
          console.log('Restarting app...');
          if (this.worker) {
            process.kill(this.worker.pid);
          }
          this._startServer((worker) => {
            this.worker = worker;
          });
        }
      });
    }
  }

  private afterEmit = (compilation: Compilation, cb: () => void): void => {
    if (this.worker && this.worker.connected) {
      const signal = getSignal(this.options.signal);
      if (signal) {
        process.kill(this.worker.pid, signal);
      }
    }

    this.startServer(compilation, cb);
  };

  apply(compiler: Compiler): void {
    compiler.hooks.afterEmit.tapAsync(
      { name: 'RunScriptPlugin' },
      this.afterEmit
    );

    if(this.options.cleanup) {
      process.on('exit', () => { this._cleanup() });
      process.on('SIGINT', () => { this._cleanup() });
    }
  }

  private startServer = (compilation: Compilation, cb: () => void): void => {
    const { assets, compiler } = compilation;
    const { options } = this;
    let name;
    const names = Object.keys(assets);
    if (options.name) {
      name = options.name;
      if (!assets[name]) {
        console.error(
          `Entry ${name} not found. Try one of: ${names.join(' ')}`
        );
      }
    } else {
      name = names[0];
      if (names.length > 1) {
        console.log(
          `More than one entry built, selected ${name}. All names: ${names.join(
            ' '
          )}`
        );
      }
    }
    if (!compiler.options.output || !compiler.options.output.path) {
      throw new Error('output.path should be defined in webpack config!');
    }

    this._entrypoint = `${compiler.options.output.path}/${name}`;
    this._startServer((worker) => {
      this.worker = worker;
      cb();
    });
  };

  private _startServer(cb: (arg0: ChildProcess) => void): void {
    const { args, nodeArgs, cwd } = this.options;
    if (!this._entrypoint) throw new Error('run-script-webpack-plugin requires an entrypoint.');

    const child = fork(this._entrypoint, args, {
      execArgv: nodeArgs,
      stdio: 'inherit',
      cwd,
    });
    setTimeout(() => cb(child), 0);
  }

  private _processExists(pid: number) {
    try {
      // Doesn't kill only checks if process id exists
      process.kill(pid, 0)
    } catch(e) {
      return false
    }
    return true
  }

  private _cleanup() {
    if(this.worker){
      console.log('\nKilling worker with process id', this.worker.pid)
      process.kill(this.worker.pid)

      // Due to OS oddities when killing a process and then killing yourself sometimes leaves the 
      // child process hanging. This loop arbitrary waits for 5 seconds

      let retry = 0
      const maxRetry = 5 
      setInterval(() => {
        if(this.worker == null) { return }
        if(retry > maxRetry) {
          console.log('Failed to kill ', this.worker.pid)
          process.exit()
        }
        if(!this._processExists(this.worker.pid)) {
          delete this.worker 
          process.exit()        
        }
        retry++
      }, 1000)
    }
  }
}

export { RunScriptWebpackPlugin };
