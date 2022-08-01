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
let postsPerPage = 6

switch (command) {
    case 'init':
        init()
        break
    case 'build':
        build()
        break
    case 'develop':
        develop(scriptArgs[1] ? Number(scriptArgs[1]) : 8000)
        break
    default:
        console.log(`Command 'teeny ${command}' does not exist.`)
        process.exit(1)
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

async function build() {
    blogPages = []
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
    // Copy files in 'static' to 'public' but filter out files that start with '.'
    await safeExecute(async () => await fs.copy('static/', 'public/'), { filter: (f) => !f.startsWith('.') })

    let contents = await fs.readdir('public')
    console.log(contents)

    await processDirectory('pages')
}

// 1. Move 'static' files into 'public/' directory
// 2. Process the 'pages/' directory which contains .md files of all pages
// 3. Create array of filenames in 'pages' directory
// 3.a. For each filename, if directory then process directory
// 3.b. If not directory, process .md file, add promise to array of processPage promises
// 4. 


async function processDirectory(directoryPath) {
    let contents = await fs.readdir(`${directoryPath}/`)
    // console.log(contents)
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

async function processPage(pagePath) {
    let templatePath = 'templates/default.html'
    // Read raw text of .md file
    const fileData = await fs.readFile(pagePath, 'utf-8')
    // Parse raw text into frontmatter and markdown
    const { attributes: frontmatter, body: markdown } = await fm(fileData)

    // Skip page is set to "publish: no"
    if (frontmatter.publish === "no") {
        return
    }
    // If there's a template, use this template instead of "default.html"
    if (frontmatter.template) {
        templatePath = `templates/${frontmatter.template}.html`
    }
    // Generate DOM of template HTML
    const dom = await JSDOM.fromFile(templatePath)
    const document = dom.window.document
    
    // Parse the path into directory and page name
    const pagePathParts = pagePath.replace('pages/', '').split('/')
    const pageName = pagePathParts.pop().split('.md')[0]
    const targetPath = pagePathParts.join('/')
    // Insert the "component_head" template into "head" element of document
    const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
    const headElement = document.getElementsByTagName('head')
    headElement[0].innerHTML = componentHead

    // const componentHeader = await fs.readFile('templates/component_header.html', 'utf-8')
    // const headerElement = document.getElementById('header')
    // headerElement.innerHTML = componentHeader
    
    // const componentNav = await fs.readFile('templates/component_nav.html', 'utf-8')
    // const navElement = document.getElementById('nav')
    // navElement.innerHTML = componentNav

    // Convert .md markdown into HTML
    const parsedHtml = marked.parse(markdown)
    const pageContentElement = document.getElementById('page-content')

    // Add .md HTML to the "page-content" div in the document
    if (pageContentElement) {
        pageContentElement.innerHTML = parsedHtml
    } else {
        console.log(
            `Could not find element with id 'page-content' in template ${templatePath}. Generating page without markdown content.`
        )
    }

    // Convert YYYYMMDD number into "Month Day, Year" string
    if (frontmatter.date) {
        const calendar = ["January","February","March","April","May","June","July","August","September","October","November","December"]
        let month = calendar[parseInt(frontmatter.date.toString().slice(4,6)) - 1]
        const day = frontmatter.date.toString().slice(6)
        const year = frontmatter.date.toString().slice(0,4)

        // Add span element with date string under page heading
        let dateSpan = document.createElement("span")
        dateSpan.setAttribute("class", "muted")
        dateSpan.innerHTML = month + " " + day + ", " + year
        let dateInsert = document.getElementsByTagName("h2")
        dateInsert[0].parentNode.insertBefore(dateSpan, dateInsert[0].nextSibling)
    }

    // Check for "html" tag, throw error if not present
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

    if (targetPath === "blog") {
        // Strip everything after READ MORE and push to blogPages
        // Add link to h2
        // Add link to REAM MORE
        // let documentCopy = document.cloneNode(true)
        // let h2 = documentCopy.getElementsByTagName("h2")[0].innerHTML
        // documentCopy.getElementsByTagName("h2")[0].innerHTML = `<a href="${targetPath}/${pageName}.html">${h2}</a>`
        // documentCopy.getElementsByClassName("readmore")[0].setAttribute("href", `${targetPath}/${pageName}.html`)
        // const readMoreParent = documentCopy.getElementsByClassName("readmore")[0].parentNode
        // while (readMoreParent.nextElementSibling !== null) {
        //     readMoreParent.nextElementSibling.remove()
        // }
        // blogPages.push([frontmatter, documentCopy.getElementById('page-content').innerHTML])
        blogPages.push([frontmatter, document])
        // document.getElementsByClassName("readmore")[0].parentNode.remove()
        return
    }

    const finalHtml = "<!DOCTYPE "+document.doctype.name+">\n"+document.getElementsByTagName('html')[0].outerHTML

    await fs.writeFile(`public/${targetPath}/${pageName}.html`, finalHtml)
}

async function blogIndex() {

    document.getElementsByClassName("readmore")[0].parentNode.remove()

    // Sort blog pages by most recent Date field
    blogPages.sort(function(a, b){return b[0].date - a[0].date})
    
    let pageCount = 0
    while (blogPages.length > postsPerPage) {
        // Slice off the first set of pages
        // Create HTML page
        // If not the first time, create folder, place HTML in that folder
        const dom = await JSDOM.fromFile('templates/index.html')
        const document = dom.window.document
        
        const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
        const headElement = document.getElementsByTagName('head')
        headElement[0].innerHTML = componentHead
        
        var aggregatePages = ""
        var blogPagesSplice = blogPages.splice(0,postsPerPage)
        for (const page of blogPagesSplice) {
            // Add Prev/Next buttons to each blog
            var documentCopy = page[1].cloneNode(true)
            let h2 = documentCopy.getElementsByTagName("h2")[0].innerHTML
            documentCopy.getElementsByTagName("h2")[0].innerHTML = `<a href="${targetPath}/${pageName}.html">${h2}</a>`
            documentCopy.getElementsByClassName("readmore")[0].setAttribute("href", `${targetPath}/${pageName}.html`)
            const readMoreParent = documentCopy.getElementsByClassName("readmore")[0].parentNode
            while (readMoreParent.nextElementSibling !== null) {
                readMoreParent.nextElementSibling.remove()
            }
            aggregatePages += documentCopy.getElementById('page-content').innerHTML
        }
        const pageContentElement = document.getElementById('page-content')
        pageContentElement.innerHTML = aggregatePages
        
        const finalHtml = "<!DOCTYPE html>\n"+document.getElementsByTagName('html')[0].outerHTML
        if (pageCount === 0) {
            await fs.writeFile('public/index.html', finalHtml)
        } else {
            // await safeExecute(async () => await fs.mkdir(`public/${pageCount + 1}`))
            await fs.writeFile(`public/${pageCount + 1}.html`, finalHtml)
        }
        pageCount += 1
    }
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
