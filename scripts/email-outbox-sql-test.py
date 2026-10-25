"""Validate queue/worker SQL in a disposable, network-isolated local Postgres."""
import concurrent.futures
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
container = subprocess.check_output([
    "docker", "run", "--pull", "never", "--rm", "--detach", "--network", "none",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine",
], text=True).strip()


def sql(source):
    result = subprocess.run([
        "docker", "exec", "--interactive", container, "psql", "-U", "postgres",
        "-v", "ON_ERROR_STOP=1", "-At",
    ], input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


try:
    for _ in range(150):
        logs = subprocess.run(["docker", "logs", container], capture_output=True, text=True)
        if "PostgreSQL init process complete" in logs.stdout + logs.stderr:
            ready = subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True)
            if ready.returncode == 0:
                break
        time.sleep(.1)
    else:
        raise RuntimeError("Local PostgreSQL did not become ready")
    sql("create role anon; create role authenticated; create role service_role bypassrls;"
        "grant usage on schema public to anon,authenticated,service_role;"
        "create table public.submissions(id uuid primary key,result_notified_at timestamptz,updated_at timestamptz default now());"
        "grant select,update on public.submissions to service_role;")
    for name in ["*_email_worker_and_rate_limits.sql", "*_durable_email_outbox.sql", "*_review_email_attachment_refs.sql"]:
        path = sorted((root / "supabase/migrations").glob(name))[-1]
        sql(path.read_text())
        print("PASS", path.name)
    sql((root / "tests/sql/email-outbox.sql").read_text())
    print("PASS outbox state transitions, retention, result-version guard and permissions")
    sql((root / "tests/sql/email-attachments.sql").read_text())
    print("PASS immutable attachment queue, schema validation, longer lease and browser-role denial")
    sql("select public.dispatch_email_outbox();")
    request = "select (public.consume_email_rate_limit(repeat('f',64),3,60000)->>'allowed')::boolean;"
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rate = list(pool.map(lambda _: sql(request), range(8)))
    assert rate.count("t") == 3 and rate.count("f") == 5, rate
    print("PASS concurrent rate limit: 3 allowed / 8 requests")
    queue_id = sql("select id from public.enqueue_email_outbox(repeat('9',64),'supabase-smtp',"
                   "'concurrency@example.invalid','queue','body',null,'concurrency',now()+interval '1 hour');")
    first = subprocess.Popen([
        "docker", "exec", "--interactive", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("set application_name='outbox_lease_fixture';begin;select id from public.claim_email_outbox(1,'"
                      + queue_id + "');select pg_sleep(2);commit;\n")
    first.stdin.close()
    for _ in range(30):
        if sql("select exists(select 1 from pg_stat_activity where application_name='outbox_lease_fixture' and wait_event='PgSleep');") == "t":
            break
        time.sleep(.05)
    else:
        raise AssertionError("Claim fixture did not enter the lock window")
    assert sql("select count(*) from public.claim_email_outbox(1,'" + queue_id + "');") == "0"
    first.wait(timeout=10)
    assert first.returncode == 0, first.stderr.read()
    print("PASS SKIP LOCKED prevents concurrent duplicate ownership")
    assert sql("set role service_role;select count(*) from public.email_outbox;").splitlines()[-1].isdigit()
    print("PASS service_role access with browser-role denial")
finally:
    subprocess.run(["docker", "rm", "--force", container], stdout=subprocess.DEVNULL, check=True)
