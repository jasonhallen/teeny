# Teeny: A simple static site generator

> **⚠️ Disclaimer:** This is a tool I built in a couple of hours to generate my personal blog [yakkomajuri.github.io](https://yakkomajuri.github.io). It doesn't do much right now and probably won't ever. 

## 🏃 Quick start

```shell
npm i -g teeny-cli # yarn global add teeny-cli
teeny init && teeny develop
```

For an example of a project using Teeny, check out my [personal blog's repo](https://github.com/yakkomajuri/yakkomajuri.github.io).

## 📖 Backstory

You can read about my motivation for building Teeny on [this blog post titled "Why I built my own static site generator"](https://yakkomajuri.github.io/blog/teeny).

## 💻 Supported commands

**Initialize a Teeny project in the current directory**

```shell
teeny init
```

**Build the static HTML files and add them to `public/`**

```shell
teeny build
```

**Start a local Teeny server that listens for file changes**

```shell
teeny develop
```


## 📄 How it works

Teeny is a super simple static site generator built to suit my needs and my needs only. 

All it does is generate pages based on HTML templates and Markdown content.

It does very little and is strongly opinionated (_read: I was too lazy to build customization/conditional handlers_), but has allowed me to build a blog I'm happy with extremely quickly.

Essentially, there are really only 2 concepts you need to think about: templates and pages.

**Templates**

Templates are plain HTML and should be added to a `templates/` subdirectory. 

They can contain an element with the id `page-content`, which is where Teeny adds the HTML generated by parsing the Markdown content.

**Pages**

Markdown is a first-class citizen in Teeny, so all of your website's pages are defined by a Markdown file. 

The file need not have any actual content though, so if you want a page to be defined purely in HTML you just need to create a template that is referenced from a page file.

To specify what template a page should use, you add an HTML comment on the first line of the page file, like so:

```
<!-- template: blog -->
```

In the above example, Teeny will look for a template called `blog.html`. If no template is specified, Teeny looks for a `default.html` file in `templates/` and uses that.

## 💡 Example usage

Here's an example of Teeny at work.

To start a Teeny project, run `teeny init`. This will create the following in your current directory:

```
.
├── pages
│   └── index.md
├── static
│   └── main.js
└── templates
    ├── default.html
    └── homepage.html
```

If you then run `teeny build`, you'll end up with this:

```
.
├── pages
│   └── index.md
├── public
│   ├── index.html
│   └── main.js
├── static
│   └── main.js
└── templates
    ├── default.html
    └── homepage.html
```

`index.md` uses the `homepage` template, and together they generate `index.html`. As is standard with other SSGs, static files are served from `public/`. 

You'll also notice `main.js` got moved to `public/` too. Teeny will actually take all non-template and non-page files from `pages/`, `templates/`, and `static/` and copy them to `public/`, following the same structure from the origin directory.

The reason for this is that I actually didn't want to have "magic" imports, where you have to import static assets from paths that do not correspond to the actual directory structure. As a result, I decided that static files would just live inside `templates/` and `pages/` as necessary. 

Later I did surrender to the `static/` directory approach though, as there may be assets both pages and templates want to use. Imports from `static/` are "magic", meaning you need to think about the output of `teeny build` for them to work.

The last command that Teeny supports is `teeny develop`. This creates an HTTP server to server files from the `public/` subdirectory. 

It listens for changes to the files and updates the static files on the fly (naively, by just rebuilding everything each time it detects a change).
