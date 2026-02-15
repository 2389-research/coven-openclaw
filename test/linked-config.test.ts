// ABOUTME: Tests for linked coven config reader that parses ~/.config/coven/config.toml.
// ABOUTME: Validates path resolution, TOML parsing, prefix stripping, and error handling.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

// Import after mocks are set up
const { getLinkedConfigPath, readLinkedConfig } = await import(
  "../src/linked-config.js"
);

const VALID_CONFIG = `gateway = "http://coven.porpoise-alkaline.ts.net:50051"
token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
principal_id = "b5b00360-1234-5678-9abc-def012345678"
device_name = "disaster"
`;

describe("getLinkedConfigPath", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respects XDG_CONFIG_HOME when set", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/custom/config");
    const path = getLinkedConfigPath();
    expect(path).toBe("/custom/config/coven/config.toml");
  });

  it("defaults to ~/.config when XDG_CONFIG_HOME not set", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    const path = getLinkedConfigPath();
    expect(path).toBe("/home/testuser/.config/coven/config.toml");
  });

  it("defaults to ~/.config when XDG_CONFIG_HOME is undefined", () => {
    delete process.env.XDG_CONFIG_HOME;
    const path = getLinkedConfigPath();
    expect(path).toBe("/home/testuser/.config/coven/config.toml");
  });
});

describe("readLinkedConfig", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    vi.unstubAllEnvs();
    vi.stubEnv("XDG_CONFIG_HOME", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when file doesn't exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = readLinkedConfig();
    expect(result).toBeNull();
  });

  it("parses valid config correctly", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(VALID_CONFIG);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("coven.porpoise-alkaline.ts.net:50051");
    expect(result!.token).toBe(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    );
    expect(result!.principalId).toBe("b5b00360-1234-5678-9abc-def012345678");
    expect(result!.deviceName).toBe("disaster");
  });

  it("strips http:// prefix from gateway", () => {
    const config = `gateway = "http://example.com:50051"
token = "tok"
principal_id = "id-123"
device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("example.com:50051");
  });

  it("strips https:// prefix from gateway", () => {
    const config = `gateway = "https://secure.example.com:50051"
token = "tok"
principal_id = "id-123"
device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("secure.example.com:50051");
  });

  it("returns null for malformed file with missing required fields", () => {
    const incomplete = `gateway = "http://example.com:50051"
token = "tok"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(incomplete);

    const result = readLinkedConfig();
    expect(result).toBeNull();
  });

  it("returns null for empty file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("");

    const result = readLinkedConfig();
    expect(result).toBeNull();
  });

  it("handles values with special characters (JWT tokens)", () => {
    const config = `gateway = "http://host:50051"
token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0LWlzc3VlciIsInN1YiI6InVzZXItMTIzIn0.sig-with_special.chars-here"
principal_id = "550e8400-e29b-41d4-a716-446655440000"
device_name = "my-device-01"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.token).toBe(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0LWlzc3VlciIsInN1YiI6InVzZXItMTIzIn0.sig-with_special.chars-here"
    );
    expect(result!.deviceName).toBe("my-device-01");
  });

  it("handles lines with extra whitespace", () => {
    const config = `  gateway   =   "http://host:50051"
  token = "tok"
  principal_id = "id-123"
  device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("host:50051");
    expect(result!.token).toBe("tok");
  });

  it("skips blank lines and comments", () => {
    const config = `# This is a config file
gateway = "http://host:50051"

token = "tok"
# Another comment
principal_id = "id-123"

device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("host:50051");
  });

  it("returns null when readFileSync throws non-ENOENT error", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });

    const result = readLinkedConfig();
    expect(result).toBeNull();
  });

  it("handles values containing equals signs (base64 padding)", () => {
    const config = `gateway = "host:50051"
token = "eyJhbGci.payload.sig=="
principal_id = "id-123"
device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.token).toBe("eyJhbGci.payload.sig==");
  });

  it("handles single-quoted TOML values", () => {
    const config = `gateway = 'http://host:50051'
token = 'tok'
principal_id = 'id-123'
device_name = 'dev'
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("host:50051");
    expect(result!.token).toBe("tok");
  });

  it("leaves gateway without protocol prefix unchanged", () => {
    const config = `gateway = "plain-host:50051"
token = "tok"
principal_id = "id-123"
device_name = "dev"
`;
    vi.mocked(fs.readFileSync).mockReturnValue(config);

    const result = readLinkedConfig();
    expect(result).not.toBeNull();
    expect(result!.gateway).toBe("plain-host:50051");
  });
});
