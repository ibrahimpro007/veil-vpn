package main

// Structured JSON logging to stdout.
//
// Every line is a single JSON object: {"ts":...,"level":...,"msg":...}.
// Privacy rule: peer public keys and tunnel IPs are NEVER logged at info
// level or above. They may appear at debug level only, which is off unless
// AGENT_DEBUG=1 or LOG_LEVEL=debug is set. This log stream is what journald
// captures; the bootstrap configures journald with Storage=volatile so logs
// live only in RAM (see infra/cloud-init/node-bootstrap.sh).

import (
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l LogLevel) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	default:
		return "error"
	}
}

// Logger writes structured JSON log lines to out (stdout in production).
type Logger struct {
	mu    sync.Mutex
	out   io.Writer
	debug bool
}

// NewLogger creates a logger writing to out. When debug is true, debug-level
// lines (which may contain peer keys/IPs) are emitted.
func NewLogger(out io.Writer, debug bool) *Logger {
	return &Logger{out: out, debug: debug}
}

func (l *Logger) log(level LogLevel, msg string, fields map[string]any) {
	if level == LevelDebug && !l.debug {
		return
	}
	rec := map[string]any{
		"ts":    time.Now().UTC().Format(time.RFC3339Nano),
		"level": level.String(),
		"msg":   msg,
	}
	for k, v := range fields {
		rec[k] = v
	}
	buf, err := json.Marshal(rec)
	if err != nil {
		buf = []byte(`{"level":"error","msg":"log marshal failed"}`)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	buf = append(buf, '\n')
	_, _ = l.out.Write(buf)
}

// Debug logs at debug level. May include peer keys/IPs — off by default.
func (l *Logger) Debug(msg string, fields map[string]any) { l.log(LevelDebug, msg, fields) }

// Info logs at info level. Must never include peer keys or tunnel IPs.
func (l *Logger) Info(msg string, fields map[string]any) { l.log(LevelInfo, msg, fields) }

// Warn logs at warn level. Must never include peer keys or tunnel IPs.
func (l *Logger) Warn(msg string, fields map[string]any) { l.log(LevelWarn, msg, fields) }

// Error logs at error level. Must never include peer keys or tunnel IPs.
func (l *Logger) Error(msg string, fields map[string]any) { l.log(LevelError, msg, fields) }

var stdLog = NewLogger(os.Stdout, false)
