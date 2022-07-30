#!/usr/bin/env node

const { JSDOM } = require('jsdom')
const fs = require('fs-extra')
const marked = require('marked')
const http = require('http')
const chokidar = require('chokidar')
const fm = require('front-matter')

// attributes: { template: "custom.html" }
// body: "# My normal markdown ..."
const scriptArgs = process.argv.slice(2)
const command = scriptArgs[0]
let blogPages = []

switch (command) {
    case 'build':
        build()
        break
    case 'develop':
        develop(scriptArgs[1] ? Number(scriptArgs[1]) : 8000)
        break
    case 'init':
        init()
        break
    default:
        console.log(`Command 'teeny ${command}' does not exist.`)
        process.exit(1)
}

async function build() {
    await fs.emptyDir('public/')

    await safeExecute(
        async () =>
            // Copy files in 'templates' to 'public' but filter out files that start with '.' or end with '.html'
            await fs.copy('templates/', 'public/', { filter: (f) => !f.startsWith('.') && !f.endsWith('.html') })
    )
    await safeExecute(
        // Copy files in 'pages' to 'public' but filter out files that start with '.' or end with '.md'
        async () => await fs.copy('pages/', 'public/', { filter: (f) => !f.startsWith('.') && !f.endsWith('.md') })
    )
    let contents = await fs.readdir(`public/blog/`)
    console.log(contents)
    // Copy files in 'static' to 'public' but filter out files that start with '.'
    await safeExecute(async () => await fs.copy('static/', 'public/'), { filter: (f) => !f.startsWith('.') })

    await processDirectory('pages')
}

async function processDirectory(directoryPath) {
    let contents = await fs.readdir(`${directoryPath}/`)
    console.log(contents)
    const processPagePromises = []
    for (const element of contents) {
        const isDirectory = (await fs.lstat(`${directoryPath}/${element}`)).isDirectory()
        if (isDirectory) {
            await processDirectory(`${directoryPath}/${element}`, processPagePromises)
            continue
        }
        processPagePromises.push(processPage(`${directoryPath}/${element}`))
    }
    await Promise.all(processPagePromises)
    await blogIndex()
}

async function develop(port) {
    await build()
    const server = startServer(port)
    const watcher = chokidar.watch(['pages/', 'static/', 'templates/']).on('change', async (path, _) => {
        console.log(`Detected change in file ${path}. Restarting development server.`)
        server.close()
        await watcher.close()
        await develop(port)
    })
}

async function init() {
    await safeExecute(async () => await fs.mkdir('pages/'))
    await safeExecute(async () => await fs.mkdir('static/'))
    await safeExecute(async () => await fs.mkdir('templates/'))

    const examplePage = `---\ntemplate: homepage\n---\n# Hello World`
    const exampleTemplate = `<html><body><p>My first Teeny page</p><div id='page-content'></div><script type="text/javascript" src='main.js'></body></html>`
    const defaultTemplate = `<html><body><div id='page-content'></div></body></html>`
    const exampleStaticAssetJs = `console.log('hello world')`

    await fs.writeFile('pages/index.md', examplePage)
    await fs.writeFile('templates/homepage.html', exampleTemplate)
    await fs.writeFile('templates/default.html', defaultTemplate)
    await fs.writeFile('static/main.js', exampleStaticAssetJs)
}

async function processPage(pagePath) {
    let templatePath = 'templates/default.html'
    const fileData = await fs.readFile(pagePath, 'utf-8')
    const { attributes: frontmatter, body: markdown } = await fm(fileData)
    if (frontmatter.template) {
        templatePath = `templates/${frontmatter.template}.html`
    }
    const dom = await JSDOM.fromFile(templatePath)
    const parsedHtml = marked.parse(markdown)
    const document = dom.window.document
    
    const pagePathParts = pagePath.replace('pages/', '').split('/')
    const pageName = pagePathParts.pop().split('.md')[0]
    const targetPath = pagePathParts.join('/')

    const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
    const headElement = document.getElementsByTagName('head')
    headElement[0].innerHTML = componentHead

    // const componentHeader = await fs.readFile('templates/component_header.html', 'utf-8')
    // const headerElement = document.getElementById('header')
    // headerElement.innerHTML = componentHeader
    
    // const componentNav = await fs.readFile('templates/component_nav.html', 'utf-8')
    // const navElement = document.getElementById('nav')
    // navElement.innerHTML = componentNav

    const pageContentElement = document.getElementById('page-content')

    if (pageContentElement) {
        pageContentElement.innerHTML = parsedHtml
    } else {
        console.log(
            `Could not find element with id 'page-content' in template ${templatePath}. Generating page without markdown content.`
        )
    }

    if (frontmatter.date) {
        const calendar = ["January","February","March","April","May","June","July","August","September","October","November","December"]
        let month = calendar[parseInt(frontmatter.date.toString().slice(4,6)) - 1]
        const day = frontmatter.date.toString().slice(6)
        const year = frontmatter.date.toString().slice(0,4)
        let dateSpan = document.createElement("span")
        dateSpan.setAttribute("class", "muted")
        dateSpan.innerHTML = month + " " + day + ", " + year
        let dateInsert = document.getElementsByTagName("h2")
        dateInsert[0].parentNode.insertBefore(dateSpan, dateInsert[0].nextSibling)
    }

    if (targetPath === "blog") {
        // Strip everything after READ MORE and push to blogPages
        let pageContentChildren = [pageContentElement.children]
        let readMoreIndex = pageContentChildren.findIndex((element) => element.className === "readmore")
        console.log(readMoreIndex)
        for (let index in pageContentChildren.length) {
            if (index > readMoreIndex) {
                pageContentChildren[index].remove()
            }
        }
        blogPages.push([frontmatter, parsedHtml])
    }

    // Strip out READ MORE element

    const wrapperHtmlElement = document.getElementsByTagName('html')
    if (!wrapperHtmlElement.length) {
        console.log(`Templates should contain the 'html' tag.`)
        process.exit(1)
    }

    let title = frontmatter.title
    if (!title) {
        const h1s = document.getElementsByTagName('h1')
        if (h1s.length) {
            title = h1s[0].innerHTML
        }
    }

    if (title) {
        document.title = title
    }

    const finalHtml = "<!DOCTYPE "+document.doctype.name+">\n"+document.getElementsByTagName('html')[0].outerHTML

    await fs.writeFile(`public/${targetPath}/${pageName}.html`, finalHtml)
}

async function blogIndex() {
    
    // blogPages should have brief HTML with date included but cut off after Read More
    // Create link out of h2s
    // Add date lines

    const dom = await JSDOM.fromFile('templates/index.html')
    const document = dom.window.document
    
    const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
    const headElement = document.getElementsByTagName('head')
    headElement[0].innerHTML = componentHead

    let aggregatePages = ""
    blogPages.sort(function(a, b){return b[0].date - a[0].date})
    for (const page of blogPages) {
        aggregatePages += page[1]
    }

    const pageContentElement = document.getElementById('page-content')
    pageContentElement.innerHTML = aggregatePages
    
    const finalHtml = "<!DOCTYPE html>\n"+document.getElementsByTagName('html')[0].outerHTML

    // let finalDom = await JSDOM(finalHtml)
    // let finalDocument = finalDom.window.document
    // let h2Array= finalDocument.getElementsByTagName("h2")
    // for (h2 in h2Array) {
    //     let dateSpan = finalDocument.createElement("span")
    //     dateSpan.setAttribute("class", "muted")
    //     dateSpan.innerHTML = month + " " + day + ", " + year
    //     dateInsert[0].parentNode.insertBefore(dateSpan, dateInsert[0].nextSibling)
    // }
    
    await fs.writeFile(`public/index.html`, finalHtml)

    // console.log(blogPages)
}

function startServer(port) {
    console.log(`Development server starting on http://localhost:${port}`)
    return http
        .createServer(function (req, res) {
            const url = req.url
            let filePath = url
            if (url === '/') {
                filePath = '/index.html'
            } else if (!url.includes('.')) {
                filePath += '.html'
            }
            fs.readFile('public' + filePath, function (err, data) {
                if (err) {
                    res.writeHead(404)
                    res.end('<h1>404: Page not found</h1>')
                    return
                }
                res.writeHead(200)
                res.end(data)
            })
        })
        .listen(port)
}

function formatDate() {

}

async function safeExecute(func) {
    try {
        await func()
    } catch {}
}
