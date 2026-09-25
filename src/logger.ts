// Lightweight stderr logger for the Vulcan Qwencode runtime.
// 本文件提供 Vulcan Qwencode 运行时使用的轻量 stderr 日志器。

// RuntimeLogger describes the small logging surface shared by hooks, gRPC, and diagnostics.
// RuntimeLogger 描述 hooks、gRPC 与诊断逻辑共享的小型日志接口。
export interface RuntimeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// createRuntimeLogger creates one stderr logger and gates debug logs behind an environment switch.
// createRuntimeLogger 创建一个 stderr 日志器，并通过环境变量开关控制 debug 日志。
export function createRuntimeLogger(debugEnabled = process.env.VULCAN_QWENCODE_DEBUG === "1"): RuntimeLogger {
  return {
    debug(message: string) {
      if (debugEnabled) {
        process.stderr.write(`[vulcan-qwencode][debug] ${message}\n`);
      }
    },
    info(message: string) {
      process.stderr.write(`[vulcan-qwencode][info] ${message}\n`);
    },
    warn(message: string) {
      process.stderr.write(`[vulcan-qwencode][warn] ${message}\n`);
    },
    error(message: string) {
      process.stderr.write(`[vulcan-qwencode][error] ${message}\n`);
    },
  };
}
