import { HomeLayout } from "fumadocs-ui/layouts/home";
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found";

import { baseOptions } from "@/lib/layout";

export const NotFound = () => (
  <HomeLayout {...baseOptions()}>
    <DefaultNotFound />
  </HomeLayout>
);
