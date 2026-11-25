import {
  Card as FluidCard,
  CardDescription,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@preprocess/ui/components/card";
import {
  TabItem,
  TabPanel,
  Tabs as FluidTabs,
  TabsList,
} from "@preprocess/ui/components/tabs";
import { useRouter } from "@tanstack/react-router";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps, ReactNode } from "react";

import { Configured } from "./configured";

// Code blocks keep Fumadocs' highlighting and copy button but sit outside
// the typeset, which would otherwise draw its own block behind them.
function Pre(props: ComponentProps<"pre">) {
  const CodeBlock = defaultMdxComponents.pre;
  return (
    <div className="not-typeset">
      <CodeBlock {...props} />
    </div>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return (
    <CardGroup border="outlined" className="not-typeset" columns={2} separated>
      {children}
    </CardGroup>
  );
}

function Card({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href: string;
}) {
  const router = useRouter();
  return (
    <FluidCard label={title} onClick={() => void router.navigate({ href })}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
    </FluidCard>
  );
}

function Tabs({ items, children }: { items: string[]; children: ReactNode }) {
  return (
    <FluidTabs className="not-typeset" defaultValue={items[0]}>
      <TabsList>
        {items.map((item) => (
          <TabItem key={item} label={item} value={item} />
        ))}
      </TabsList>
      {children}
    </FluidTabs>
  );
}

function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabPanel className="mt-3" value={value}>
      {children}
    </TabPanel>
  );
}

export const getMDXComponents = (components?: MDXComponents) =>
  ({
    ...defaultMdxComponents,
    pre: Pre,
    Card,
    Cards,
    Tab,
    Tabs,
    Configured,
    ...components,
  }) satisfies MDXComponents;

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
