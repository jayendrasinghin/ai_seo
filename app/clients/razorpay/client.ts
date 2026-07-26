import { decrypt } from "../../lib/encryption";

export class RazorpayClient {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  static fromEncrypted(
    encryptedKeyId: string,
    encryptedKeySecret: string,
  ): RazorpayClient {
    return new RazorpayClient(decrypt(encryptedKeyId), decrypt(encryptedKeySecret));
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  /** Lightweight credential check against Razorpay API. */
  async testConnection(): Promise<void> {
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Razorpay authentication failed — check Key ID and Secret");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Razorpay API error (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
