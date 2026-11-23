"""A slow link in front of the sandbox's sshd, for e2e/slow-launch.sh.

    python3 e2e/slow-relay.py <run directory> <sshd port> <seconds>

Listens on a free port of 127.0.0.1 and writes it to <run directory>/relay.port.
Each connection goes on to the sshd, and the sshd's first bytes, its SSH
banner, are held for <seconds>: every new Connection of the app takes that
much longer to sign in, and nothing after that is slowed. It prints one
"relayed" line for each Connection.

It writes nothing outside the run directory, and it stops by itself once the
run directory is gone, which is the last thing the sandbox does.
"""

import os
import socket
import sys
import threading
import time

root, target_port, delay = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])


def pipe(source, sink, hold):
    first = True
    try:
        while True:
            data = source.recv(65536)
            if not data:
                break
            if first and hold:
                time.sleep(delay)
            first = False
            sink.sendall(data)
    except OSError:
        pass
    finally:
        for end in (source, sink):
            try:
                end.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def serve(client):
    print(f"relayed a Connection, its banner held {delay} s", flush=True)
    try:
        upstream = socket.create_connection(("127.0.0.1", target_port))
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, upstream, False), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client, True), daemon=True).start()


def stop_with_the_run():
    while os.path.isdir(root):
        time.sleep(0.5)
    os._exit(0)


listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", 0))
listener.listen(16)
with open(os.path.join(root, "relay.port.tmp"), "w") as out:
    out.write(str(listener.getsockname()[1]))
os.rename(os.path.join(root, "relay.port.tmp"), os.path.join(root, "relay.port"))
threading.Thread(target=stop_with_the_run, daemon=True).start()
while True:
    connection, _ = listener.accept()
    serve(connection)
