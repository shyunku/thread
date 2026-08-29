FROM node:16-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/app
COPY apps/web/site/package.json apps/web/site/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web/site ./
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/web/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/app/build /usr/share/nginx/html
EXPOSE 80
