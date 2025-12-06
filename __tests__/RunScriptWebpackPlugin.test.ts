import { RunScriptWebpackPlugin } from '../src/index';
import { Compiler, Compilation } from 'webpack';
import { fork } from 'child_process';

jest.mock('child_process', () => ({
  fork: jest.fn(),
}));

describe('RunScriptWebpackPlugin', () => {
  let compiler: Compiler;
  let compilation: Compilation;
  let mockFork: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockFork = fork as unknown as jest.Mock;
    mockFork.mockClear();

    // Basic mock of the Compiler
    compiler = {
      hooks: {
        afterEmit: {
          tapAsync: jest.fn(),
        },
      },
      options: {
        output: {
            path: '/dist'
        }
      }
    } as unknown as Compiler;

    // Basic mock of the Compilation
    compilation = {
      assets: {
        'main.js': {
            source: () => '',
            size: () => 0
        },
        'other.js': {
            source: () => '',
            size: () => 0
        }
      },
      compiler: compiler,
      outputOptions: {
        path: '/dist'
      }
    } as unknown as Compilation;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should be an instance of RunScriptWebpackPlugin', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js' });
    expect(plugin).toBeInstanceOf(RunScriptWebpackPlugin);
  });

  it('should hook into afterEmit', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js' });
    plugin.apply(compiler);
    expect(compiler.hooks.afterEmit.tapAsync).toHaveBeenCalledWith(
      { name: 'RunScriptPlugin' },
      expect.any(Function)
    );
  });

  it('should start server after emit', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js' });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();
    callback(compilation, doneCallback);

    expect(mockFork).toHaveBeenCalledWith(
        '/dist/main.js',
        [],
        expect.objectContaining({ execArgv: expect.any(Array) })
    );

    jest.runAllTimers();
    expect(doneCallback).toHaveBeenCalled();
  });

  it('should pass arguments to fork', () => {
    const plugin = new RunScriptWebpackPlugin({
        name: 'main.js',
        args: ['--arg1'],
        nodeArgs: ['--inspect']
    });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();
    callback(compilation, doneCallback);

    expect(mockFork).toHaveBeenCalledWith(
        '/dist/main.js',
        ['--arg1'],
        expect.objectContaining({ execArgv: ['--inspect'] })
    );
  });

  it('should restart server on subsequent emit', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js' });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();

    // First run
    callback(compilation, doneCallback);
    jest.runAllTimers();
    expect(mockFork).toHaveBeenCalledTimes(1);

    // Second run (restart)
    callback(compilation, doneCallback);

    expect(process.kill).toHaveBeenCalledWith(123, undefined);

    jest.runAllTimers(); // Handle the setTimeout in the new _startServer call
    expect(mockFork).toHaveBeenCalledTimes(2); // Should fork again
  });

  it('should NOT restart server if autoRestart is false', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js', autoRestart: false });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();

    // First run
    callback(compilation, doneCallback);
    jest.runAllTimers();
    expect(mockFork).toHaveBeenCalledTimes(1);

    // Second run (should NOT restart)
    callback(compilation, doneCallback);

    expect(process.kill).not.toHaveBeenCalled();
    expect(mockFork).toHaveBeenCalledTimes(1);
    expect(doneCallback).toHaveBeenCalledTimes(2); // Callback should still be called
  });

  it('should send custom signal when restarting', () => {
    const plugin = new RunScriptWebpackPlugin({ name: 'main.js', signal: 'SIGINT' });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();

    // First run
    callback(compilation, doneCallback);
    jest.runAllTimers();

    // Second run
    callback(compilation, doneCallback);

    expect(process.kill).toHaveBeenCalledWith(123, 'SIGINT');
  });

  it('should pick the first asset if name is not provided', () => {
    const plugin = new RunScriptWebpackPlugin({});
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();
    callback(compilation, doneCallback);

    // 'main.js' is the first key in the assets object defined in beforeEach
    expect(mockFork).toHaveBeenCalledWith(
        '/dist/main.js',
        [],
        expect.objectContaining({})
    );
  });

  it('should log error if named asset is not found', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const plugin = new RunScriptWebpackPlugin({ name: 'missing.js' });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();
    callback(compilation, doneCallback);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Entry missing.js not found'));
    expect(mockFork).toHaveBeenCalledWith(
        '/dist/missing.js',
        expect.anything(),
        expect.anything()
    );
  });

  it('should pass cwd and env options to fork', () => {
    const customEnv = { TEST_VAR: 'value' };
    const plugin = new RunScriptWebpackPlugin({
        name: 'main.js',
        cwd: '/custom/cwd',
        env: customEnv
    });
    plugin.apply(compiler);

    const tapAsyncMock = compiler.hooks.afterEmit.tapAsync as jest.Mock;
    const callback = tapAsyncMock.mock.calls[0][1];

    mockFork.mockReturnValue({
        pid: 123,
        connected: true,
        kill: jest.fn(),
        on: jest.fn()
    });

    const doneCallback = jest.fn();
    callback(compilation, doneCallback);

    expect(mockFork).toHaveBeenCalledWith(
        '/dist/main.js',
        [],
        expect.objectContaining({
            cwd: '/custom/cwd',
            env: customEnv
        })
    );
  });
});
