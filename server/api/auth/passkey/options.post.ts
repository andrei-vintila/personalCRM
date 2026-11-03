import { defineHandler } from "nitro/h3";
import { authenticationOptions } from "../../../utils/passkeys";

export default defineHandler((event) => authenticationOptions(event));
