"""Native Hermes tools; credentials stay in Sandboxer's companion vault."""
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error

ROUTES = json.loads(Path(__file__).with_name("routes.json").read_text())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def call(kind, args):
    path = args.get("path", "")
    if not isinstance(path, str) or not re.fullmatch(ROUTES[kind], path):
        raise ValueError("Unsupported Sandboxer path")
    port = os.environ.get("SANDBOXER_SERVICE_PORT", "47381")
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ValueError("Invalid SANDBOXER_SERVICE_PORT")
    token = os.environ.get("SANDBOXER_SERVICE_TOKEN")
    if not token:
        raise ValueError("Set SANDBOXER_SERVICE_TOKEN in the host environment")
    body = json.dumps(args.get("body", {})).encode() if kind == "action" else None
    if body and len(body) > 256 * 1024:
        raise ValueError("Request too large")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="GET" if kind == "read" else "POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=30) as response:
        data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise ValueError("Response too large")
        return json.loads(data)


def handler(kind):
    def run(args, **kwargs):
        try:
            return json.dumps(call(kind, args))
        except urllib.error.HTTPError as error:
            return json.dumps({"error": f"Sandboxer request failed ({error.code}); check service configuration and job logs"})
        except ValueError:
            return json.dumps({"error": "Invalid Sandboxer request, configuration or response"})
        except Exception:
            return json.dumps({"error": "Sandboxer service unavailable"})
    return run


def register(ctx):
    for kind in ("read", "action"):
        name = f"sandboxer_{kind}"
        description = (
            "Read Sandboxer /environments, /servers, /plans, /images, /templates, /jobs, /audit, /controller, /clusters, /cluster-plans, /reports/{environmentId}, /clusters/{uuid}/nodes or workloads."
            if kind == "read" else
            "POST Sandboxer /environments (name, plan, image UUID, template, sshKey), /environments/adopt (serverId), /environments/{id}/{start|stop|restart|connect|refresh|dns|server-key|deploy|snapshot|enroll|tls}, /clusters, or /clusters/{uuid}/{logs|restart|scale|apply|upgrade|add-nodes}. Deploy body: repo, full staging sha, install, build, test, start. Snapshot: project. Enroll: idleMinutes, lifetimeMinutes. TLS: email, port. Logs: namespace, pod. Restart: namespace, deployment. Scale: group, count. Apply: yaml. Upgrade: version. Actions can incur charges or interrupt workloads. Inspect /jobs for queued job completion.")
        properties = {"path": {"type": "string", "pattern": ROUTES[kind]}}
        if kind == "action":
            properties["body"] = {"type": "object", "additionalProperties": True}
        ctx.register_tool(name=name, toolset="sandboxer", schema={
            "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": ["path"], "additionalProperties": False},
        }, handler=handler(kind))
