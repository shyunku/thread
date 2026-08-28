FROM node:16-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/memorial_site
COPY memorial_site/package.json memorial_site/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY memorial_site ./
RUN pnpm build

FROM nginx:1.27-alpine
COPY memorial_site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/memorial_site/build /usr/share/nginx/html
EXPOSE 80
