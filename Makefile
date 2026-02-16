.PHONY: start stop

PORT     := 8081
ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PID_FILE := $(ROOT_DIR).server.pid

start:
	@if [ -f "$(PID_FILE)" ] && kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
		echo "⏵ Already running (PID $$(cat "$(PID_FILE)")) → http://localhost:$(PORT)"; \
	else \
		python3 -m http.server $(PORT) --directory "$(ROOT_DIR)" >/dev/null 2>&1 & \
		echo $$! > "$(PID_FILE)"; \
		sleep 0.5; \
		if kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
			echo "⏵ Started → http://localhost:$(PORT)  (PID $$(cat "$(PID_FILE)"))"; \
		else \
			echo "✗ Failed to start. Is port $(PORT) in use?"; \
			rm -f "$(PID_FILE)"; \
		fi; \
	fi

stop:
	@if [ -f "$(PID_FILE)" ] && kill -0 $$(cat "$(PID_FILE)") 2>/dev/null; then \
		kill $$(cat "$(PID_FILE)"); \
		rm -f "$(PID_FILE)"; \
		echo "⏹ Server stopped."; \
	else \
		echo "⏹ No server running."; \
		rm -f "$(PID_FILE)"; \
	fi
