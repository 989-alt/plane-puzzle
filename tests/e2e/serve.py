"""e2e 시험용 정적 서버(저장소 루트, 127.0.0.1). 같은 프로세스의 스레드로 띄운다.

`python -m http.server` 는 Windows 에서 대기열(backlog)이 작아, 페이지가 글꼴·그림·문제 은행을 한꺼번에 받을 때
가끔 ERR_CONNECTION_REFUSED 를 낸다. 여기서는 대기열을 넉넉히 잡는다.
"""
import functools
import http.server
import threading


class _Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start(root, port):
    handler = functools.partial(_Quiet, directory=root)
    srv = _Server(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    class Handle:
        def terminate(self):
            srv.shutdown()
            srv.server_close()

    return Handle()
