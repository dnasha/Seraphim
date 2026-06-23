import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getUser: vi.fn(),
  deleteUser: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createAdminClient }));

import { POST } from "@/app/api/auth/delete-account/route";

function request(headers: Record<string, string>) {
  return new Request("https://seraphim.example/api/auth/delete-account", { method: "POST", headers });
}

describe("POST /api/auth/delete-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The admin client is mocked below; use a dummy value so this unit test is
    // independent of local .env files and GitHub Actions secrets.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: vi.fn(), delete: vi.fn() });
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.createAdminClient.mockReturnValue({ auth: { admin: { deleteUser: mocks.deleteUser } } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without a same-origin CSRF signal before creating clients", async () => {
    const missing = await POST(request({ host: "seraphim.example" }));
    const crossSite = await POST(request({ host: "seraphim.example", origin: "https://evil.example" }));

    expect(missing.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("requires an authenticated user after CSRF validation", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(request({ host: "seraphim.example", origin: "https://seraphim.example" }));

    expect(response.status).toBe(401);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user with the server-side admin client", async () => {
    const response = await POST(request({ host: "seraphim.example", origin: "https://seraphim.example" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("surfaces a controlled server error when deletion fails", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { message: "delete failed" } });

    const response = await POST(request({ host: "seraphim.example", origin: "https://seraphim.example" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "delete failed" });
  });
});
