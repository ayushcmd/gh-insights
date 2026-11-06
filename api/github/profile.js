import { endpoint, username } from "../../lib/api-helpers.js";
import { getProfile, publicProfile } from "../../lib/github.js";

export default endpoint(async (req) => publicProfile(await getProfile(username(req))), { methods: ["GET"] });
