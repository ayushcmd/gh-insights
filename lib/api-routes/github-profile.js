import { endpoint, username } from "../api-helpers.js";
import { getProfile, publicProfile } from "../github.js";

export default endpoint(async (req) => publicProfile(await getProfile(username(req))), { methods: ["GET"] });
