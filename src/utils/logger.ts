import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logLevel: string;
  private levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  private logDir: string;
  private logFile: string;
  private enableFileLogging: boolean;

  constructor(logLevel: string = 'info', enableFileLogging: boolean = true) {
    this.logLevel = logLevel;
    this.enableFileLogging = enableFileLogging;

    // 设置日志目录和文件
    this.logDir = path.join(process.cwd(), 'logs');
    const now = new Date();
    const timestamp = this.getLogTimestamp(now); // YYYY-MM-DD-HH
    this.logFile = path.join(this.logDir, `app-${timestamp}.log`);

    // 创建日志目录（如果不存在）
    if (this.enableFileLogging) {
      this.ensureLogDirectory();
      this.rotateOldLogs();
    }
  }

  private getLogTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`; // YYYY-MM-DD-HH
  }

  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
      this.enableFileLogging = false;
    }
  }

  private rotateOldLogs(): void {
    try {
      // 删除超过 30 天的日志文件
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 天（毫秒）

      files.forEach(file => {
        if (file.startsWith('app-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const stats = fs.statSync(filePath);
          const age = now - stats.mtime.getTime();

          if (age > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`Deleted old log file: ${file}`);
          }
        }
      });
    } catch (error) {
      console.error('Failed to rotate old logs:', error);
    }
  }

  private shouldLog(level: string): boolean {
    return this.levels[level as keyof typeof this.levels] >= this.levels[this.logLevel as keyof typeof this.levels];
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ') : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}`;
  }

  private writeToFile(message: string): void {
    if (!this.enableFileLogging) return;

    try {
      // 检查是否需要切换到新的日志文件（小时变化）
      const now = new Date();
      const currentTimestamp = this.getLogTimestamp(now);
      const expectedLogFile = path.join(this.logDir, `app-${currentTimestamp}.log`);

      if (this.logFile !== expectedLogFile) {
        this.logFile = expectedLogFile;
        this.rotateOldLogs();
      }

      fs.appendFileSync(this.logFile, message + '\n', 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      const formattedMessage = this.formatMessage('debug', message, ...args);
      console.log(formattedMessage);
      this.writeToFile(formattedMessage);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      const formattedMessage = this.formatMessage('info', message, ...args);
      console.log(formattedMessage);
      this.writeToFile(formattedMessage);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      const formattedMessage = this.formatMessage('warn', message, ...args);
      console.warn(formattedMessage);
      this.writeToFile(formattedMessage);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      const formattedMessage = this.formatMessage('error', message, ...args);
      console.error(formattedMessage);
      this.writeToFile(formattedMessage);
    }
  }
}
