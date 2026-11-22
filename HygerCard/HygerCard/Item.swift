//
//  Item.swift
//  HygerCard
//
//  Created by Christopher Boette on 11/21/26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}


//@Model
final class Blyg {
    var title: String
    var authors: [String]
    var location: URL

    init(title: String, authors: [String], location: URL) {
        self.title = title
        self.authors = authors
        self.location = location
    }
}

enum Kind: String { case fragment, thread}

//@Model
final class Post {
    let kind: Kind
    let parent: Blyg
    let author: [String]
    let body: String
    let hasQuote: Bool
    
    init(parent: Blyg, kind: Kind, author: [String], body: String, hasQuote: Bool) {
        self.parent = parent
        self.kind = kind
        self.author = author
        self.body = body
        self.hasQuote = hasQuote
    }
}
